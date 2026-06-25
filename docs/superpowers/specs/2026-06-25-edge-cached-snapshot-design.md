# Edge-Cached Snapshot Mirror — Design Spec

**Date:** 2026-06-25
**Status:** Approved (brainstorming)

## Goal

Stop every viewer from hitting Supabase directly. Today each browser tab is its own
Supabase client: it paginates the full flight history over REST on load
(`useTelemetry.js`), opens a Realtime Broadcast WebSocket for live rows, and polls
Storage every 5–60 s for the latest image (`useLatestImage.js`). Supabase load therefore
scales with viewer count.

Replace that with a **shared, edge-cached snapshot**: two Cloudflare Pages Functions
become the *only* things that talk to Supabase, and every viewer reads them through
Cloudflare's edge cache. Supabase load drops from **O(viewers)** to roughly
**O(active edge locations × 1/TTL)** — i.e. it stops scaling with viewer count and the
dashboard comfortably serves into the low thousands.

The user has accepted **near-real-time freshness (~2–5 s)** in exchange for this. Live
updates become a short-interval poll of a cached file rather than a per-viewer WebSocket.

## Constraints (inherited)

- **No test suite.** Verify with `npm run lint` (no errors) and `npm run build`
  (succeeds). Manual / visual checks go to the user (no browser in this environment).
- **All UI strings and code comments in Finnish.** Match this in any new frontend code.
  Server-side Function code may use English comments (it is not user-facing), but keep it
  consistent and clear.
- **No Supabase backend access.** The user controls only the frontend and the Cloudflare
  Pages deploy. This design lives **entirely on Cloudflare** (Pages Functions + env vars)
  and needs no SQL, no Edge Function, and no schema change on Supabase.
- **Anon key is public and read-only.** It moves into Pages Function env vars; this is no
  new exposure (it already ships in the browser bundle today).
- **Preserve the core invariants** of `useTelemetry.js` — see "Invariants to preserve".

## Accepted trade-offs

1. **Freshness drops to ~poll-interval (≈4 s) instead of sub-second.** Intended.
2. **Cache is per edge location (POP).** Supabase therefore sees ~one refresh per POP per
   cache window, not literally one globally. Still bounded by POP count × 1/TTL, never by
   viewer count.
3. **The in-progress Broadcast DB trigger (`docs/broadcast-migration.sql`) is no longer
   needed by the frontend.** Polling replaces the WebSocket, removing the frontend's
   dependency on a backend-owned trigger being deployed. The SQL file stays in the repo as
   a documented fallback but is not required for this design.

---

## Architecture

```
Supabase ──(server-side, ~1 req per TTL per POP)──► Pages Function ──► Cloudflare edge cache ──► all viewers
```

Two cacheable endpoints, each a single shared URL with **no per-client query
parameters** (per-client params would fragment the cache per viewer and destroy the
coalescing — this is the load-bearing rule of the whole design):

### `GET /api/history`

The full-history backfill a freshly-arriving viewer needs once.

- **Server logic** (mirrors `fetchInitialData` in `useTelemetry.js`):
  1. Pick the current flight by the **newest `created_at` row → its `flight_id`** (NOT the
     highest `flight_id` — numbering is not chronological). Invariant preserved.
  2. Paginate that flight's full history, 1000 rows/page, selecting only the UI columns
     (`created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa`).
  3. Apply the cleaning pipeline server-side: drop `isBadRow` sentinels, null implausible
     `cleanSpeed` values, and run `withCleanFix` across the full ascending sequence (it has
     the whole series, so the coordinate-jump check is exact here).
- **Response shape:**
  ```json
  { "flightId": 12, "startMs": 1750000000000, "rows": [ /* cleaned rows, ascending */ ] }
  ```
  `startMs` = epoch ms of the first row's `created_at` (drives the flight timer).
  Each row keeps the cleaned UI-column shape consumed by `toHistoryEntry`.
- **Headers:** `Cache-Control: public, s-maxage=30, stale-while-revalidate=30`.
  Refreshed at most once per 30 s per POP — fresh enough for a new arrival's backfill,
  since live tail keeps already-open viewers current.

### `GET /api/latest`

The live tail every viewer polls, plus the current image.

- **Server logic:**
  1. Current flight (same newest-`created_at` rule).
  2. Fetch the last ~60 rows (`order by created_at desc limit 60`, then return ascending),
     cleaned with the same pipeline. 60 rows >> a few seconds of telemetry, so it always
     covers the poll interval with margin even if a poll is missed.
  3. Resolve the latest image URL server-side (the `findLatestImage` global-newest-by-
     `created_at` scan from `useLatestImage.js` moves here).
- **Response shape:**
  ```json
  { "flightId": 12, "rows": [ /* last ~60 cleaned rows, ascending */ ], "imageUrl": "https://…/12/cap_….jpg" }
  ```
- **Headers:** `Cache-Control: public, s-maxage=3, stale-while-revalidate=3`.

### Cleaning at the window seam

`withCleanFix`'s jump check needs the previous good coordinate. `/api/latest` cleans its
60-row window independently each call, seeding its running "last good" from the start of
that window. Because the window overlaps history the client already holds, and the client
**dedups by `rawTimeMs` keeping the existing (history) version**, only genuinely new rows
take the `/latest` version — and by the time the sequence reaches those newest rows, the
window has already established a solid "last good" coordinate. Any seam discontinuity is
therefore negligible. Cleaning lives in **one shared server-side module** imported by both
Functions (single source of truth).

---

## Frontend changes

### `src/hooks/useTelemetry.js`

- **Initial load:** replace the paginated Supabase REST loop with a single
  `fetch('/api/history')`. Map `rows` through `toHistoryEntry`; set `flightStartMs` from
  `startMs`; seed `telemetry`, `maxAlt`, `minTemp`, `maxSpeed` from the rows (the existing
  `observeMax`/`observeMin` reducers). Keep the retry-with-backoff wrapper for transient
  fetch failures.
- **Live updates:** replace the Broadcast channel subscription with a `setInterval` that
  polls `/api/latest` every ~4 s (constant `POLL_INTERVAL_MS`). On each poll, feed each row
  through the existing `updateData` merge path — it already dedups by `rawTimeMs`, detects a
  changed `flight_id` (new flight → reset), and updates aggregates incrementally. **The
  buffering-during-initial-load machinery is removed**: poll only starts after
  `/api/history` resolves, so there is no race to buffer against.
- **`status` derivation:** online ⇔ the last poll succeeded **and** the newest row is within
  `STALE_THRESHOLD_MS`; otherwise offline. The freshness timer concept stays; the
  WebSocket-subscription signal (`channelSubscribedRef`) is replaced by a "last poll
  succeeded" flag.
- **`imageUrl`:** `/api/latest` already returns it, so `useTelemetry` exposes `imageUrl` in
  its return value — giving **one poll loop per viewer** for both telemetry and image.
- **Client-side cleaning** (`isBadRow`, `cleanSpeed`, `withCleanFix`, `distanceKm`) is now
  redundant on the happy path (server cleans). Keep them only if cheap defense-in-depth is
  wanted; default is to **remove them from the client** and treat the server as the single
  source of truth. (Decide during implementation; removal is preferred for clarity.)

### `src/hooks/useLatestImage.js`

- **Removed entirely.** Its Storage-polling network activity is gone; `imageUrl` now rides
  in the `/api/latest` payload.

### `src/App.jsx`

- Read `imageUrl` from `useTelemetry` instead of calling `useLatestImage`. Pass it to the
  image card exactly as before. No layout change.

### New: Pages Functions + shared module

- `functions/api/history.js` — the `/api/history` handler.
- `functions/api/latest.js` — the `/api/latest` handler.
- `functions/_shared/clean.js` (or similar) — the cleaning pipeline + flight-selection +
  Supabase-fetch helpers shared by both, ported from `useTelemetry.js`.
- Functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TABLE` from Pages
  environment variables (set in the Cloudflare Pages dashboard, both Production and
  Preview). They may use `@supabase/supabase-js` or plain `fetch` against the Supabase REST
  endpoint — implementation choice; plain `fetch` avoids shipping the client into the
  Function bundle.

---

## Invariants to preserve

- **Flight selection by newest `created_at`, never highest `flight_id`** — in both
  Functions.
- **New-flight detection** — a changed `flight_id` (even a lower number) in `/api/latest`
  resets history/aggregates; reuse the existing `updateData` new-flight branch.
- **Bad-data cleaning semantics** — sentinel drop, speed nulling, Null-Island / >150 km
  jump invalidation (time-scaled max jump) — ported verbatim server-side.
- **Flight timer anchored to server timestamps** — `startMs` from `/api/history`'s first
  row keeps `FlightTimer` drift-free.

## Cost / ops — to VERIFY during implementation (not assumed)

- Cloudflare serves cache **hits** at the edge **without invoking the Function**; only
  **misses** (≈1 per TTL per POP) invoke it and reach Supabase. **Confirm** that Pages
  Functions cache-hit responses do not count against the Functions request quota, and that
  caching of dynamic Function responses behaves as expected (Cache API usage vs.
  `Cache-Control` headers — may require explicitly using `caches.default` in the handler).
- Budget **Workers/Pages Paid (~$5/mo)** as the safety margin if free-tier Function
  invocation limits are a concern at the target scale.
- Set Supabase env vars in the Pages project (Production + Preview) before first deploy, or
  the Functions return errors.

## Explicitly NOT doing (YAGNI)

- **No R2 / cron / Durable Objects.** Documented below as the upgrade path only.
- **No auth, no per-client query parameters** (the latter would break edge caching).
- **No Supabase-side changes** (no SQL, no removing the Broadcast trigger — that is
  backend-owned; the frontend simply stops subscribing).

## Documented upgrade path — true tens-of-thousands ("10k dream")

When raw poll volume against Cloudflare (not Supabase) becomes the binding limit, switch
the **read path** to a pure static file: a scheduled writer (Cron-triggered Worker for the
slow history snapshot; a Durable Object alarm loop for the fast `/latest`, since cron's
floor is 1 min) regenerates the snapshots into **R2**, and viewers read static objects the
CDN serves **without invoking any Function at all** (R2 has no egress fees). Same snapshot
concept and same JSON contracts — only the delivery changes — so the frontend is untouched
by the upgrade.

## Verification

- `npm run lint` — no errors.
- `npm run build` — succeeds.
- Manual (handed to user): with the Functions deployed, a viewer loads history once, the
  chart/map/metrics populate, the live tail advances every ~4 s, the image updates, the
  status pill goes online, and a new flight resets cleanly. Confirm in the Cloudflare
  dashboard that Supabase request volume is flat regardless of how many tabs are open.
