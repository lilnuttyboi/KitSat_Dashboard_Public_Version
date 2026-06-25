# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A public, read-only real-time dashboard (Finnish UI) that visualizes telemetry from a KitSat / stratospheric-balloon flight: altitude, temperature, pressure, speed, a live map track, a flight timer, and the latest onboard camera image. React 19 + Vite; data comes from Supabase (Postgres + Realtime + Storage).

## Commands

- `npm run dev` — Vite dev server with HMR (default port 5173; Vite auto-picks the next free port if taken)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build
- `npm run lint` — ESLint (flat config in `eslint.config.js`)

There is **no test suite**. Verify changes with `npm run lint` and `npm run build`.

## Environment

The browser no longer talks to Supabase directly. Two Cloudflare Pages Functions (`functions/api/history.js`, `functions/api/latest.js`) read Supabase server-side and serve edge-cached JSON snapshots; the app fetches `/api/history` once on load and polls `/api/latest` every ~4 s. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_TABLE` as **Pages environment variables** (server-side, no `VITE_` prefix) in the Cloudflare dashboard for Production and Preview. The anon key is public and read-only; access control still relies on Supabase RLS (anon read-only on the telemetry table and `camera` Storage bucket).

## Architecture

The app splits into a **data layer** (`src/hooks/`) and a **presentation layer** (`src/components/`, `src/App.jsx`). The complexity lives in the data layer.

A third **edge layer** (`functions/`) sits between the app and Supabase: Pages Functions that build cached snapshots so Supabase load no longer scales with viewer count. See `docs/superpowers/specs/2026-06-25-edge-cached-snapshot-design.md` for the rationale and the documented R2 upgrade path for tens-of-thousands of viewers. The bad-data cleaning, flight selection, and Supabase access now live in `functions/_shared/` (`clean.js`, `supabase.js`, `snapshot.js`) and are exercised by standalone `node` scripts (`*.check.mjs`, `functions.smoke.mjs`; `npm run check` runs the offline ones).

### Telemetry — `src/hooks/useTelemetry.js`
The heart of the app. It fetches `/api/history` once (full cleaned flight history) then polls `/api/latest` every ~4 s (recent rows + latest image URL). The bad-data cleaning now lives **server-side** in `functions/_shared/clean.js` (single source of truth), shared by both Functions via `functions/_shared/snapshot.js`. The hook still derives `status` from data freshness (a stale-data timer), and detects a new flight when a polled row's `flight_id` changes (any change, even a lower number) — on which it re-fetches `/api/history` for the new flight's full track. The **newest `created_at`, not highest `flight_id`** invariant is preserved, now enforced in `functions/_shared/supabase.js`.

**Bad-data cleaning** (understand before removing), in `functions/_shared/clean.js`: sentinel rows (`temp 0 / pressure 1013.25 / no fix`) are dropped; GPS speeds > 300 m/s are nulled; coordinates at Null Island or jumping > 150 km (time-scaled) between consecutive samples are invalidated (`gps_fix → false`) so the map doesn't draw a line to Africa. `withCleanFix` mutates a shared "last good coordinate" container so the jump check stays continuous across each snapshot's rows.

### Images
The latest image URL is resolved **server-side** in `functions/_shared/supabase.js` (`fetchLatestImageUrl`: scan every `camera` folder — `<flight_id>/cap_*.jpg` — pick the globally newest by `created_at`, never by folder-name sort) and returned in the `/api/latest` payload. `src/components/LatestImage.jsx` is a pure presentational component taking `imageUrl` + `loading` props — there is no separate image-polling hook.

### Presentation
- `src/App.jsx` — layout grid, theme hook, time-range buttons (1m/5m/30m/1h/MAX), and the `MetricCard` used for each metric.
- `src/components/MetricChart.jsx` → `TelemetryChart.jsx` — the charts (recharts). These **hand-roll** range filtering, min/max-preserving downsampling, and "nice" Y-axis ticks instead of relying on recharts defaults; make axis/tick/scaling changes here.
- `src/components/MapComponent.jsx` — Leaflet map (theme-aware CARTO tiles, balloon marker, route polyline). It and `MetricChart` are **lazy-loaded** so Leaflet/recharts land in separate chunks and keep the initial bundle small.
- `src/components/FlightTimer.jsx` — elapsed flight time, anchored to server timestamps to avoid client-clock drift.

### Theming
Dark/light via CSS custom properties in `src/App.css`, switched through `document.documentElement.dataset.theme`. Theme follows the OS until the user toggles it, then the choice is saved in `localStorage`. The header stays dark in both themes.

## Conventions

- **All code comments and UI strings are in Finnish.** Match this when editing.
- recharts gotcha: `YAxis width={0}` makes the tick labels disappear entirely — keep the width above 0.
