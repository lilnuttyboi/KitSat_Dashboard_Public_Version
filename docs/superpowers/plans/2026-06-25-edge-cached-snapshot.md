# Edge-Cached Snapshot Mirror — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every viewer off direct Supabase access onto two edge-cached Cloudflare Pages Functions (`/api/history`, `/api/latest`) so Supabase load no longer scales with viewer count.

**Architecture:** Two Pages Functions in `functions/` become the only code that talks to Supabase. Each builds a JSON snapshot (current flight's history / live tail + latest image) using shared, runtime-agnostic modules, sets `Cache-Control`, and coalesces via the Workers Cache API (`caches.default`). The React app fetches `/api/history` once on load, then polls `/api/latest` every ~4 s. The per-viewer REST history loop, Realtime Broadcast subscription, and Storage polling are all removed.

**Tech Stack:** React 19 + Vite (frontend, ESM, `type: module`); Cloudflare Pages Functions (Workers runtime, ESM `.js`); plain `fetch` against Supabase REST + Storage REST (no `@supabase/supabase-js` in Functions); Node 18+ built-in `fetch`/`node:assert` for standalone verification scripts (`.mjs`, matching the `loadtests/` precedent).

## Global Constraints

- **No frontend test suite.** Frontend tasks verify with `npm run lint` (no errors) and `npm run build` (succeeds); behavioral checks are handed to the user. Server-side logic is verified with standalone `.mjs` scripts run via `node` (the `loadtests/` pattern), not a unit-test framework.
- **All code comments and UI strings in Finnish** — including the new Pages Function code (this overrides the spec's "English allowed" note; CLAUDE.md takes precedence).
- **No Supabase backend changes.** No SQL, no schema change, no Edge Function. Everything lives on Cloudflare.
- **Cached endpoints take NO per-client query parameters.** One shared URL each, or edge caching fragments per viewer and the coalescing breaks. This is load-bearing.
- **Preserve invariants:** current flight = newest `created_at` row's `flight_id` (NEVER highest `flight_id`); a changed `flight_id` (even lower) = new flight → full reset; bad-data cleaning semantics (`isBadRow` sentinel drop, `cleanSpeed` > 300 m/s → null, `withCleanFix` Null-Island / time-scaled >150 km jump → `gps_fix:false`); flight timer anchored to server timestamps.
- **Pages env vars (server-side, no `VITE_` prefix):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TABLE`. The anon key is public + read-only; no new exposure.
- **Telemetry columns (exact):** `created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa`.
- **Public test backend (anon key is public + read-only — safe in scripts):** URL `https://fyqehnpjprbcuinmumud.supabase.co`, table `telemetry`, bucket `camera`, anon key `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cWVobnBqcHJiY3Vpbm11bXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzE3ODEsImV4cCI6MjA5NTg0Nzc4MX0.zuP6Ck6jIhxdxx6rgG5u4p4LGeYHKxcce4yI1fru3Mg`.

## File Structure

| File | Responsibility |
|------|----------------|
| `eslint.config.js` (modify) | Add override so `functions/**/*.js` lint with worker+node globals and without React plugins. |
| `functions/_shared/clean.js` (create) | Pure cleaning helpers ported from `useTelemetry.js`: `isBadRow`, `cleanSpeed`, `distanceKm`, `withCleanFix` + consts. Runtime-agnostic. |
| `functions/_shared/supabase.js` (create) | `fetch`-based Supabase REST/Storage helpers: `selectCurrentFlightId`, `fetchFlightHistory`, `fetchLatestRows`, `fetchLatestImageUrl`. |
| `functions/_shared/snapshot.js` (create) | `buildHistorySnapshot`, `buildLatestSnapshot` — compose supabase + clean into response objects. |
| `functions/_shared/http.js` (create) | `serveCached(context, buildFn, maxAge)` + `jsonResponse` — Cache-API coalescing + JSON response. |
| `functions/api/history.js` (create) | `onRequestGet` → `/api/history`. |
| `functions/api/latest.js` (create) | `onRequestGet` → `/api/latest`. |
| `functions/_shared/clean.check.mjs` (create) | Standalone assert script for the cleaning helpers. |
| `functions/_shared/snapshot.check.mjs` (create) | Standalone assert script: builders with a mock `fetchImpl` (no network). |
| `functions/_shared/functions.smoke.mjs` (create) | Standalone integration script: stubs `globalThis.caches`, calls both handlers against the real public backend. |
| `src/hooks/useTelemetry.js` (rewrite) | Fetch `/api/history` once + poll `/api/latest`; expose `imageUrl`; derive `status` from freshness. |
| `src/hooks/useLatestImage.js` (delete) | Folded into `/api/latest`. |
| `src/components/LatestImage.jsx` (modify) | Take `imageUrl` + `loading` props instead of calling the hook. |
| `src/App.jsx` (modify) | Pass `imageUrl` from `useTelemetry` to `<LatestImage>`. |
| `src/supabaseClient.js` (delete) | Unused after the rewrite. |
| `package.json` (modify) | Add `"check"` script running the `.mjs` verification scripts. |
| `CLAUDE.md`, `.env.example` (modify) | Document the new snapshot architecture + Pages env vars. |

---

### Task 1: Cleaning module + lint override + verification harness

**Files:**
- Modify: `eslint.config.js`
- Create: `functions/_shared/clean.js`
- Create: `functions/_shared/clean.check.mjs`
- Modify: `package.json` (add `check` script)

**Interfaces:**
- Produces: `isBadRow(d) -> boolean`, `cleanSpeed(v) -> number|null`, `distanceKm(aLat,aLon,bLat,bLon) -> number`, `withCleanFix(row, last) -> row` where `last` is `{ value: {lat,lon,ms}|null }` (mutated in place). Also exports `MAX_PLAUSIBLE_SPEED`, `MAX_JUMP_KM`.

- [ ] **Step 1: Add the ESLint override** so the new Function `.js` files lint cleanly (they export `onRequestGet`, not React components, and use worker globals like `caches`/`Response`).

In `eslint.config.js`, add a new config object to the array **after** the existing block:

```js
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.node },
    },
    rules: {
      // Pages Functions vievät onRequestGet:n, ei React-komponentteja.
      'react-refresh/only-export-components': 'off',
    },
  },
```

- [ ] **Step 2: Write the failing verification script** `functions/_shared/clean.check.mjs`:

```js
import assert from 'node:assert/strict';
import {
  isBadRow, cleanSpeed, distanceKm, withCleanFix,
} from './clean.js';

// isBadRow: sentinel-rivi (temp 0 / pressure 1013.25 / no fix) hylätään
assert.equal(isBadRow({ temp_c: 0, pressure_hpa: 1013.25, gps_fix: false }), true);
assert.equal(isBadRow({ temp_c: -5, pressure_hpa: 900, gps_fix: true }), false);

// cleanSpeed: yli 300 m/s -> null, kelvollinen säilyy
assert.equal(cleanSpeed(7660), null);
assert.equal(cleanSpeed(-1), null);
assert.equal(cleanSpeed(NaN), null);
assert.equal(cleanSpeed(42), 42);
assert.equal(cleanSpeed(null), null);

// distanceKm: Helsinki -> Tukholma ~395 km
assert.ok(Math.abs(distanceKm(60.17, 24.94, 59.33, 18.07) - 395) < 20);

// withCleanFix: Null Island (lon=0) -> gps_fix false
{
  const last = { value: null };
  const r = withCleanFix({ gps_lat: 0, gps_lon: 21.79, gps_fix: true, created_at: '2026-06-25T00:00:00Z' }, last);
  assert.equal(r.gps_fix, false);
}
// withCleanFix: uskottava liike säilyy ja last päivittyy
{
  const last = { value: null };
  const a = withCleanFix({ gps_lat: 61.0, gps_lon: 22.0, gps_fix: true, created_at: '2026-06-25T00:00:00Z' }, last);
  assert.equal(a.gps_fix, true);
  assert.equal(last.value.lat, 61.0);
}
// withCleanFix: >150 km hyppy 1 s:ssa -> gps_fix false
{
  const last = { value: { lat: 61.0, lon: 22.0, ms: new Date('2026-06-25T00:00:00Z').getTime() } };
  const r = withCleanFix({ gps_lat: 65.0, gps_lon: 28.0, gps_fix: true, created_at: '2026-06-25T00:00:01Z' }, last);
  assert.equal(r.gps_fix, false);
}

console.log('clean.check.mjs OK');
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node functions/_shared/clean.check.mjs`
Expected: FAIL — `Cannot find module '.../functions/_shared/clean.js'`.

- [ ] **Step 4: Create `functions/_shared/clean.js`** (ported verbatim from `src/hooks/useTelemetry.js`, exported):

```js
// Telemetrian datan siivous — jaettu Pages Functionsien kesken (yksi totuus).
// Portattu src/hooks/useTelemetry.js:stä; toimii sekä Workers- että Node-ajossa.

export const isBadRow = (d) =>
  d.temp_c === 0 && d.pressure_hpa === 1013.25 && d.gps_fix === false;

// GPS raportoi epäuskottavia nopeuspiikkejä; hylätään yli rajan menevät (-> null).
export const MAX_PLAUSIBLE_SPEED = 300; // m/s
export const cleanSpeed = (v) =>
  typeof v === 'number' && !Number.isNaN(v) && v >= 0 && v <= MAX_PLAUSIBLE_SPEED ? v : null;

export const MAX_JUMP_KM = 150;

export const distanceKm = (aLat, aLon, bLat, bLon) => {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Palauttaa rivin, jonka gps_fix on false jos sijainti ei ole uskottava.
// last = mutatoitava { value: {lat,lon,ms}|null } -säiliö, joka kantaa viimeisen
// kelvollisen sijainnin rivien yli. Sallittu hyppy skaalautuu kuluneen ajan mukaan.
export const withCleanFix = (row, last) => {
  if (!row.gps_fix) return row;
  const lat = row.gps_lat, lon = row.gps_lon;
  const inRange =
    typeof lat === 'number' && typeof lon === 'number' &&
    !Number.isNaN(lat) && !Number.isNaN(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    lat !== 0 && lon !== 0;
  if (!inRange) return { ...row, gps_fix: false };
  const ms = new Date(row.created_at).getTime();
  if (last.value) {
    const elapsedS = Number.isFinite(ms) ? Math.max(1, (ms - last.value.ms) / 1000) : 1;
    const maxJumpKm = Math.max(MAX_JUMP_KM, (elapsedS * MAX_PLAUSIBLE_SPEED) / 1000);
    if (distanceKm(last.value.lat, last.value.lon, lat, lon) > maxJumpKm) {
      return { ...row, gps_fix: false };
    }
  }
  last.value = { lat, lon, ms };
  return row;
};
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node functions/_shared/clean.check.mjs`
Expected: prints `clean.check.mjs OK`, exit code 0.

- [ ] **Step 6: Add the `check` script** to `package.json` `scripts` (after `"lint"`). For now it runs only the cleaning checks; Task 3 extends it once `snapshot.check.mjs` exists (keeping every intermediate state runnable):

```json
    "check": "node functions/_shared/clean.check.mjs",
```

- [ ] **Step 7: Run lint to confirm the override works**

Run: `npm run lint`
Expected: no errors (the new `functions/_shared/clean.js` lints clean; `.mjs` files are outside the lint glob).

- [ ] **Step 8: Commit**

```bash
git add eslint.config.js functions/_shared/clean.js functions/_shared/clean.check.mjs package.json
git commit -m "Add shared telemetry-cleaning module for Pages Functions"
```

---

### Task 2: Supabase REST/Storage fetch helpers

**Files:**
- Create: `functions/_shared/supabase.js`
- Create: `functions/_shared/functions.smoke.mjs` (initial version — Supabase helpers only; extended in Task 4)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces, all taking `cfg = { url, anonKey, table, bucket?, fetchImpl? }` (`fetchImpl` defaults to global `fetch`):
  - `selectCurrentFlightId(cfg) -> Promise<number|string|null>`
  - `fetchFlightHistory(cfg, flightId) -> Promise<Row[]>` (ascending, all pages)
  - `fetchLatestRows(cfg, flightId, limit=60) -> Promise<Row[]>` (ascending)
  - `fetchLatestImageUrl(cfg) -> Promise<string|null>`

- [ ] **Step 1: Write the failing smoke script** `functions/_shared/functions.smoke.mjs`:

```js
// Integraatiosavutesti oikeaa (julkista, vain-luku) Supabasea vasten.
// Aja: node functions/_shared/functions.smoke.mjs
import assert from 'node:assert/strict';
import {
  selectCurrentFlightId, fetchFlightHistory, fetchLatestRows, fetchLatestImageUrl,
} from './supabase.js';

const cfg = {
  url: 'https://fyqehnpjprbcuinmumud.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cWVobnBqcHJiY3Vpbm11bXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzE3ODEsImV4cCI6MjA5NTg0Nzc4MX0.zuP6Ck6jIhxdxx6rgG5u4p4LGeYHKxcce4yI1fru3Mg',
  table: 'telemetry',
  bucket: 'camera',
};

const flightId = await selectCurrentFlightId(cfg);
console.log('flightId:', flightId);
assert.ok(flightId !== undefined, 'flightId should be defined (number or null)');

if (flightId != null) {
  const latest = await fetchLatestRows(cfg, flightId, 60);
  assert.ok(Array.isArray(latest), 'latest rows is array');
  if (latest.length > 1) {
    assert.ok(latest[0].created_at <= latest[latest.length - 1].created_at, 'ascending order');
  }
  console.log('latest rows:', latest.length);

  const hist = await fetchFlightHistory(cfg, flightId);
  assert.ok(Array.isArray(hist), 'history is array');
  assert.ok(hist.length >= latest.length, 'history >= latest window');
  console.log('history rows:', hist.length);
}

const imageUrl = await fetchLatestImageUrl(cfg);
console.log('imageUrl:', imageUrl);
assert.ok(imageUrl === null || imageUrl.startsWith('https://'), 'image url is https or null');

console.log('functions.smoke.mjs OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node functions/_shared/functions.smoke.mjs`
Expected: FAIL — `Cannot find module '.../supabase.js'`.

- [ ] **Step 3: Create `functions/_shared/supabase.js`:**

```js
// Supabase REST + Storage -haut pelkällä fetchillä (ei @supabase/supabase-js:ää).
// Kaikki funktiot ottavat cfg:n; fetchImpl mahdollistaa mockauksen testeissä.

const restHeaders = (anonKey) => ({ apikey: anonKey, Authorization: `Bearer ${anonKey}` });

const COLUMNS =
  'created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa';
const PAGE = 1000;

// Tuorein lento valitaan uusimman created_at:n mukaan — EI suurimman flight_id:n.
export async function selectCurrentFlightId(cfg) {
  const { url, anonKey, table, fetchImpl = fetch } = cfg;
  const q = `${url}/rest/v1/${table}?select=flight_id&flight_id=not.is.null&order=created_at.desc&limit=1`;
  const r = await fetchImpl(q, { headers: restHeaders(anonKey) });
  if (!r.ok) throw new Error(`flight lookup ${r.status}`);
  const rows = await r.json();
  return rows[0]?.flight_id ?? null;
}

export async function fetchFlightHistory(cfg, flightId) {
  const { url, anonKey, table, fetchImpl = fetch } = cfg;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const q = `${url}/rest/v1/${table}?select=${COLUMNS}&flight_id=eq.${flightId}` +
      `&order=created_at.asc&limit=${PAGE}&offset=${from}`;
    const r = await fetchImpl(q, { headers: restHeaders(anonKey) });
    if (!r.ok) throw new Error(`history ${r.status}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

export async function fetchLatestRows(cfg, flightId, limit = 60) {
  const { url, anonKey, table, fetchImpl = fetch } = cfg;
  const q = `${url}/rest/v1/${table}?select=${COLUMNS}&flight_id=eq.${flightId}` +
    `&order=created_at.desc&limit=${limit}`;
  const r = await fetchImpl(q, { headers: restHeaders(anonKey) });
  if (!r.ok) throw new Error(`latest ${r.status}`);
  const rows = await r.json();
  return rows.reverse(); // desc -> asc
}

// Globaalisti uusin kuva: listaa juuren kansiot, jokaisesta tuorein tiedosto,
// vertaa created_at:t. Kansioiden nimien lajittelu ei saa valita väärää lentoa.
export async function fetchLatestImageUrl(cfg) {
  const { url, anonKey, bucket = 'camera', fetchImpl = fetch } = cfg;
  const listUrl = `${url}/storage/v1/object/list/${bucket}`;
  const headers = { ...restHeaders(anonKey), 'content-type': 'application/json' };

  const rootRes = await fetchImpl(listUrl, {
    method: 'POST', headers,
    body: JSON.stringify({ prefix: '', limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!rootRes.ok) return null;
  const entries = await rootRes.json();
  const folders = (entries ?? []).filter((e) => e.id === null); // kansioilla id === null

  let newest = null;
  for (const folder of folders) {
    const res = await fetchImpl(listUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ prefix: folder.name, limit: 1, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    if (!res.ok) continue;
    const files = await res.json();
    const file = files?.[0];
    if (!file) continue;
    const createdAt = file.created_at ?? file.updated_at ?? '';
    if (!newest || createdAt > newest.createdAt) {
      newest = { path: `${folder.name}/${file.name}`, createdAt };
    }
  }
  if (!newest) return null;
  return `${url}/storage/v1/object/public/${bucket}/${newest.path}`;
}
```

- [ ] **Step 4: Run the smoke script to verify it passes**

Run: `node functions/_shared/functions.smoke.mjs`
Expected: prints `flightId:`, row counts, `imageUrl:`, then `functions.smoke.mjs OK`, exit 0. (Requires network. If the project is between flights, `flightId` may be a value with rows; an empty backend still passes via the `null`/array assertions.)

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add functions/_shared/supabase.js functions/_shared/functions.smoke.mjs
git commit -m "Add fetch-based Supabase REST/Storage helpers for Functions"
```

---

### Task 3: Snapshot builders

**Files:**
- Create: `functions/_shared/snapshot.js`
- Create: `functions/_shared/snapshot.check.mjs`

**Interfaces:**
- Consumes: `clean.js` (`isBadRow`, `cleanSpeed`, `withCleanFix`); `supabase.js` (all four helpers).
- Produces:
  - `buildHistorySnapshot(cfg) -> Promise<{ flightId, startMs: number|null, rows: Row[] }>`
  - `buildLatestSnapshot(cfg) -> Promise<{ flightId, rows: Row[], imageUrl: string|null }>`

- [ ] **Step 1: Write the failing unit script** `functions/_shared/snapshot.check.mjs` (uses a mock `fetchImpl`, no network):

```js
import assert from 'node:assert/strict';
import { buildHistorySnapshot, buildLatestSnapshot } from './snapshot.js';

// Mock fetch: reitittää URL:n perusteella. Palauttaa { ok, json }.
function mockFetch(rows, { imageRoot = [], imageFiles = {} } = {}) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/list/')) {
      const body = JSON.parse(opts.body);
      const data = body.prefix === '' ? imageRoot : (imageFiles[body.prefix] ?? []);
      return { ok: true, json: async () => data };
    }
    if (u.includes('select=flight_id&')) {
      return { ok: true, json: async () => (rows.length ? [{ flight_id: rows[rows.length - 1].flight_id }] : []) };
    }
    // historia/latest: palautetaan rivit (desc jos latest-kysely, muuten asc)
    const desc = u.includes('order=created_at.desc') && !u.includes('select=flight_id');
    const out = [...rows];
    return { ok: true, json: async () => (desc ? out.reverse() : out) };
  };
}

const baseRows = [
  { created_at: '2026-06-25T00:00:00Z', flight_id: 7, gps_lat: 61, gps_lon: 22, gps_alt: 100, gps_speed: 5, gps_fix: true, temp_c: -5, pressure_hpa: 900 },
  { created_at: '2026-06-25T00:00:01Z', flight_id: 7, gps_lat: 61.001, gps_lon: 22.001, gps_alt: 110, gps_speed: 9999, gps_fix: true, temp_c: -6, pressure_hpa: 890 },
  { created_at: '2026-06-25T00:00:02Z', flight_id: 7, gps_lat: 0, gps_lon: 0, gps_fix: false, temp_c: 0, pressure_hpa: 1013.25 }, // bad row
];

const cfg = { url: 'http://x', anonKey: 'k', table: 't', bucket: 'camera' };

// history: bad row pudotettu, nopeuspiikki nullattu, startMs ensimmäisestä rivistä
{
  const snap = await buildHistorySnapshot({ ...cfg, fetchImpl: mockFetch(baseRows) });
  assert.equal(snap.flightId, 7);
  assert.equal(snap.rows.length, 2, 'bad row dropped');
  assert.equal(snap.rows[1].gps_speed, null, 'implausible speed nulled');
  assert.equal(snap.startMs, new Date('2026-06-25T00:00:00Z').getTime());
}

// latest: imageUrl ratkaistaan uusimman created_at:n mukaan eri kansioista
{
  const snap = await buildLatestSnapshot({
    ...cfg,
    fetchImpl: mockFetch(baseRows, {
      imageRoot: [{ id: null, name: '6' }, { id: null, name: '7' }],
      imageFiles: {
        '6': [{ name: 'cap_old.jpg', created_at: '2026-06-25T00:00:00Z' }],
        '7': [{ name: 'cap_new.jpg', created_at: '2026-06-25T00:05:00Z' }],
      },
    }),
  });
  assert.equal(snap.flightId, 7);
  assert.ok(snap.rows.length === 2);
  assert.ok(snap.imageUrl.endsWith('/camera/7/cap_new.jpg'), `got ${snap.imageUrl}`);
}

// tyhjä backend: ei kaadu
{
  const snap = await buildHistorySnapshot({ ...cfg, fetchImpl: mockFetch([]) });
  assert.equal(snap.flightId, null);
  assert.deepEqual(snap.rows, []);
  assert.equal(snap.startMs, null);
}

console.log('snapshot.check.mjs OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node functions/_shared/snapshot.check.mjs`
Expected: FAIL — `Cannot find module '.../snapshot.js'`.

- [ ] **Step 3: Create `functions/_shared/snapshot.js`:**

```js
// Rakentaa /api/history- ja /api/latest-vastausten hyötykuormat: hakee datan
// (supabase.js) ja siivoaa sen (clean.js) — yksi totuus siivouslogiikalle.
import { isBadRow, cleanSpeed, withCleanFix } from './clean.js';
import {
  selectCurrentFlightId, fetchFlightHistory, fetchLatestRows, fetchLatestImageUrl,
} from './supabase.js';

const cleanRows = (raw) => {
  const last = { value: null }; // withCleanFix mutatoi: jatkuva sijaintivertailu ikkunan yli
  return raw
    .filter((d) => !isBadRow(d))
    .map((d) => withCleanFix({ ...d, gps_speed: cleanSpeed(d.gps_speed) }, last));
};

export async function buildHistorySnapshot(cfg) {
  const flightId = await selectCurrentFlightId(cfg);
  if (flightId == null) return { flightId: null, startMs: null, rows: [] };
  const rows = cleanRows(await fetchFlightHistory(cfg, flightId));
  const startMs = rows.length ? new Date(rows[0].created_at).getTime() : null;
  return { flightId, startMs, rows };
}

export async function buildLatestSnapshot(cfg) {
  const flightId = await selectCurrentFlightId(cfg);
  const rows = flightId == null ? [] : cleanRows(await fetchLatestRows(cfg, flightId, 60));
  const imageUrl = await fetchLatestImageUrl(cfg);
  return { flightId, rows, imageUrl };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node functions/_shared/snapshot.check.mjs`
Expected: prints `snapshot.check.mjs OK`, exit 0.

- [ ] **Step 5: Extend the `check` script** in `package.json` to also run the snapshot checks:

```json
    "check": "node functions/_shared/clean.check.mjs && node functions/_shared/snapshot.check.mjs",
```

- [ ] **Step 6: Run lint + full check**

Run: `npm run lint && npm run check`
Expected: lint clean; both `clean.check.mjs OK` and `snapshot.check.mjs OK` print.

- [ ] **Step 7: Commit**

```bash
git add functions/_shared/snapshot.js functions/_shared/snapshot.check.mjs package.json
git commit -m "Add snapshot builders for history and latest endpoints"
```

---

### Task 4: Pages Functions with edge-cache coalescing

**Files:**
- Create: `functions/_shared/http.js`
- Create: `functions/api/history.js`
- Create: `functions/api/latest.js`
- Modify: `functions/_shared/functions.smoke.mjs` (append handler-level checks)

**Interfaces:**
- Consumes: `snapshot.js` (`buildHistorySnapshot`, `buildLatestSnapshot`).
- Produces: `serveCached(context, buildFn, maxAge) -> Promise<Response>`; `jsonResponse(obj, status, maxAge) -> Response`. Each Function exports `onRequestGet(context)`.

- [ ] **Step 1: Create `functions/_shared/http.js`:**

```js
// Reunavälimuisti (Workers Cache API) + JSON-vastaus. serveCached koalesoi:
// osuma palautetaan suoraan, ohi vain kerran per TTL per reuna -> Supabasen
// kuorma ~1/TTL/reuna, ei katsojamäärän mukaan.

export function jsonResponse(obj, status, maxAge) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`,
    },
  });
}

export async function serveCached(context, buildFn, maxAge) {
  const { request, waitUntil } = context;
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  let body;
  try {
    body = await buildFn();
  } catch (err) {
    // Virhettä ei cachetata pitkään (max-age 0), jotta toipuminen on nopeaa.
    return jsonResponse({ error: 'unavailable', detail: String(err?.message ?? err) }, 503, 0);
  }
  const res = jsonResponse(body, 200, maxAge);
  waitUntil(cache.put(request, res.clone()));
  return res;
}

// Lukee Supabase-asetukset Pages-ympäristömuuttujista.
export function cfgFromEnv(env) {
  return { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, table: env.SUPABASE_TABLE, bucket: 'camera' };
}
```

- [ ] **Step 2: Create `functions/api/history.js`:**

```js
import { buildHistorySnapshot } from '../_shared/snapshot.js';
import { serveCached, cfgFromEnv } from '../_shared/http.js';

const MAX_AGE_S = 30; // koko historia uusiksi enintään kerran / 30 s / reuna

export async function onRequestGet(context) {
  return serveCached(context, () => buildHistorySnapshot(cfgFromEnv(context.env)), MAX_AGE_S);
}
```

- [ ] **Step 3: Create `functions/api/latest.js`:**

```js
import { buildLatestSnapshot } from '../_shared/snapshot.js';
import { serveCached, cfgFromEnv } from '../_shared/http.js';

const MAX_AGE_S = 3; // live-tail: tuore ~3 s

export async function onRequestGet(context) {
  return serveCached(context, () => buildLatestSnapshot(cfgFromEnv(context.env)), MAX_AGE_S);
}
```

- [ ] **Step 4: Append handler-level checks** to `functions/_shared/functions.smoke.mjs` (stub `globalThis.caches`, call the real handlers against the public backend). Add at the end, before any final log:

```js
// --- Handler-taso: stubataan caches + ctx, ajetaan oikeat onRequestGet:t ---
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const env = { SUPABASE_URL: cfg.url, SUPABASE_ANON_KEY: cfg.anonKey, SUPABASE_TABLE: cfg.table };
const ctx = (path) => ({ env, request: new Request(`https://example.test${path}`), waitUntil() {} });

const { onRequestGet: history } = await import('../api/history.js');
const hRes = await history(ctx('/api/history'));
assert.equal(hRes.status, 200, 'history 200');
assert.match(hRes.headers.get('cache-control'), /s-maxage=30/, 'history cache 30s');
const hBody = await hRes.json();
assert.ok(Array.isArray(hBody.rows), 'history rows array');
console.log('history handler rows:', hBody.rows.length);

const { onRequestGet: latest } = await import('../api/latest.js');
const lRes = await latest(ctx('/api/latest'));
assert.equal(lRes.status, 200, 'latest 200');
assert.match(lRes.headers.get('cache-control'), /s-maxage=3/, 'latest cache 3s');
const lBody = await lRes.json();
assert.ok(Array.isArray(lBody.rows), 'latest rows array');
assert.ok(lBody.imageUrl === null || lBody.imageUrl.startsWith('https://'), 'latest imageUrl');
console.log('latest handler rows:', lBody.rows.length, 'image:', lBody.imageUrl);

console.log('handlers OK');
```

Move the existing `console.log('functions.smoke.mjs OK')` to the very end of the file.

- [ ] **Step 5: Run the smoke script (handler level) to verify it passes**

Run: `node functions/_shared/functions.smoke.mjs`
Expected: prints history/latest handler row counts, `handlers OK`, then `functions.smoke.mjs OK`, exit 0.

- [ ] **Step 6: (Optional, if `wrangler` is available) serve Functions locally**

Run: `npx wrangler pages dev dist --binding SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_TABLE=telemetry` (after `npm run build`), then `curl -s localhost:8788/api/latest | head -c 400`.
Expected: JSON with `rows` and `imageUrl`. If `wrangler` is not installed, skip — Step 5 already validated the handlers.

- [ ] **Step 7: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add functions/_shared/http.js functions/api/history.js functions/api/latest.js functions/_shared/functions.smoke.mjs
git commit -m "Add /api/history and /api/latest Pages Functions with edge caching"
```

---

### Task 5: Rewrite `useTelemetry` to consume the snapshot endpoints

**Files:**
- Rewrite: `src/hooks/useTelemetry.js`

**Interfaces:**
- Consumes: `GET /api/history` → `{ flightId, startMs, rows }`; `GET /api/latest` → `{ flightId, rows, imageUrl }`.
- Produces (hook return, unchanged keys plus `imageUrl`): `{ telemetry, history, loading, error, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs, imageUrl }`.

- [ ] **Step 1: Replace the entire contents** of `src/hooks/useTelemetry.js` with:

```js
import { useState, useEffect, useRef } from 'react';

const DEV = import.meta.env.DEV;
const STALE_THRESHOLD_MS = 10_000;
const FRESHNESS_CHECK_INTERVAL_MS = 2_000;
const HISTORY_BUFFER = 200000; // turvaraja live-puskurille; riittää koko ~4 h lennolle
const HISTORY_URL = '/api/history';
const LATEST_URL = '/api/latest';
const POLL_INTERVAL_MS = 4_000;            // live-tailin pollausväli
const INITIAL_LOAD_RETRIES = 3;            // alkulatauksen uudelleenyritykset
const INITIAL_LOAD_RETRY_BASE_MS = 1500;   // viive kasvaa: 1.5 s, 3 s, 4.5 s

const toHistoryEntry = (d) => {
  const t = new Date(d.created_at);
  return {
    time: t.toLocaleTimeString(),
    rawTimeMs: t.getTime(),
    alt: d.gps_alt ?? null,
    temp: d.temp_c ?? null,
    pressure: d.pressure_hpa ?? null,
    speed: d.gps_speed ?? null,
    lat: d.gps_lat,
    lon: d.gps_lon,
    fix: d.gps_fix ?? false,
  };
};

const observeMax = (prev, v) => {
  if (v == null || Number.isNaN(v)) return prev;
  return prev == null || v > prev ? v : prev;
};
const observeMin = (prev, v) => {
  if (v == null || Number.isNaN(v)) return prev;
  return prev == null || v < prev ? v : prev;
};

// Data tulee nyt valmiiksi siivottuna palvelimelta (Pages Functions): tämä hook
// vain hakee /api/history kerran ja pollaa /api/latest:ia. Supabasen kuorma ei
// kasva katsojamäärän mukaan, koska Cloudflaren reunavälimuisti koalesoi pyynnöt.
export const useTelemetry = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // alkulataus epäonnistui (erotettu "ei dataa":sta)
  const [status, setStatus] = useState('offline');
  const [maxAlt, setMaxAlt] = useState(null);
  const [minTemp, setMinTemp] = useState(null);
  const [maxSpeed, setMaxSpeed] = useState(null);
  const [flightStartMs, setFlightStartMs] = useState(() => Date.now());
  const [lastDataMs, setLastDataMs] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);

  const lastReceivedAtRef = useRef(0);       // selainaika: viimeisin datan saapuminen
  const currentFlightIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let reloading = false;

    const markFresh = (createdAt) => {
      const t = createdAt ? new Date(createdAt).getTime() : Date.now();
      lastReceivedAtRef.current = Date.now();
      setLastDataMs(t);
      setError(false);
      setStatus('online');
    };

    const fetchSnapshot = async (url) => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return res.json();
    };

    // Korvaa koko näkymän /api/history-snapshotilla (alkulataus + uusi lento).
    const applyHistory = (snap) => {
      const rows = snap.rows ?? [];
      currentFlightIdRef.current = snap.flightId ?? null;
      if (snap.startMs) setFlightStartMs(snap.startMs);
      setTelemetry(rows.length ? rows[rows.length - 1] : null);
      setHistory(rows.map(toHistoryEntry));
      setMaxAlt(rows.reduce((m, d) => observeMax(m, d.gps_alt), null));
      setMinTemp(rows.reduce((m, d) => observeMin(m, d.temp_c), null));
      setMaxSpeed(rows.reduce((m, d) => observeMax(m, d.gps_speed), null));
      if (rows.length) {
        lastReceivedAtRef.current = Date.now();
        setLastDataMs(new Date(rows[rows.length - 1].created_at).getTime());
      }
    };

    const reloadHistory = async () => {
      if (reloading) return;
      reloading = true;
      try {
        const snap = await fetchSnapshot(HISTORY_URL);
        if (!cancelled) applyHistory(snap);
      } catch (err) {
        if (DEV) console.error('History reload error:', err);
      } finally {
        reloading = false;
      }
    };

    // Sulauttaa yhden (jo siivotun) live-rivin. Uusi flight_id -> koko historia uusiksi.
    const applyRow = (row) => {
      if (!row) return;
      const curId = currentFlightIdRef.current;
      const newId = row.flight_id;
      if (curId != null && newId !== curId) {
        currentFlightIdRef.current = newId;
        reloadHistory();
        return;
      }
      if (curId == null) {
        currentFlightIdRef.current = newId;
        setFlightStartMs(new Date(row.created_at).getTime());
      }
      setTelemetry((prev) => (prev?.created_at === row.created_at ? prev : row));
      setHistory((prev) => {
        const entry = toHistoryEntry(row);
        if (prev.length && prev[prev.length - 1].rawTimeMs === entry.rawTimeMs) return prev;
        return [...prev, entry].slice(-HISTORY_BUFFER);
      });
      setMaxAlt((prev) => observeMax(prev, row.gps_alt));
      setMinTemp((prev) => observeMin(prev, row.temp_c));
      setMaxSpeed((prev) => observeMax(prev, row.gps_speed));
      markFresh(row.created_at);
    };

    const pollLatest = async () => {
      if (document.hidden) return;
      try {
        const snap = await fetchSnapshot(LATEST_URL);
        if (cancelled) return;
        if (snap.imageUrl) setImageUrl(snap.imageUrl);
        for (const row of snap.rows ?? []) applyRow(row);
      } catch (err) {
        if (DEV) console.error('Latest poll error:', err);
      }
    };

    // Alkulataus muutamalla uudelleenyrityksellä, jottei hetkellinen verkkokatko
    // jätä koontinäyttöä tyhjäksi. Live-pollaus alkaa vasta tämän jälkeen.
    (async () => {
      let ok = false;
      for (let attempt = 0; attempt <= INITIAL_LOAD_RETRIES; attempt++) {
        if (cancelled) return;
        try {
          const snap = await fetchSnapshot(HISTORY_URL);
          if (cancelled) return;
          applyHistory(snap);
          ok = true;
          break;
        } catch (err) {
          if (DEV) console.error('Initial load error:', err);
          if (attempt < INITIAL_LOAD_RETRIES) {
            await new Promise((r) => setTimeout(r, INITIAL_LOAD_RETRY_BASE_MS * (attempt + 1)));
          }
        }
      }
      if (cancelled) return;
      setError(!ok);
      setLoading(false);
      pollLatest();
      pollTimer = setInterval(pollLatest, POLL_INTERVAL_MS);
    })();

    // Status johdetaan datan tuoreudesta: online jos viimeisin data < kynnys.
    const freshnessTimer = setInterval(() => {
      const fresh = Date.now() - lastReceivedAtRef.current < STALE_THRESHOLD_MS;
      setStatus(fresh ? 'online' : 'offline');
    }, FRESHNESS_CHECK_INTERVAL_MS);

    const onVisible = () => { if (!document.hidden) pollLatest(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      clearInterval(freshnessTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { telemetry, history, loading, error, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs, imageUrl };
};
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors (note: the single-mount `useEffect(…, [])` references only module-level consts and stable setters, so `react-hooks/exhaustive-deps` stays quiet).

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: build succeeds; `@supabase/supabase-js` no longer pulled into the telemetry path.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTelemetry.js
git commit -m "Rewrite useTelemetry to poll /api/history + /api/latest"
```

**Manual check (handed to user):** with Functions served (deployed Preview, or `wrangler pages dev`), the dashboard loads history once, the chart/map/metrics populate, the live tail advances ~every 4 s, and the status pill goes online. Plain `npm run dev` will 404 on `/api/*` (Vite doesn't run Functions) — use a Cloudflare Preview deploy or `wrangler pages dev`.

---

### Task 6: Fold the image into the snapshot poll

**Files:**
- Modify: `src/components/LatestImage.jsx`
- Modify: `src/App.jsx`
- Delete: `src/hooks/useLatestImage.js`

**Interfaces:**
- Consumes: `imageUrl` from `useTelemetry`.
- Produces: `<LatestImage imageUrl={string|null} loading={boolean} />`.

- [ ] **Step 1: Replace the contents** of `src/components/LatestImage.jsx`:

```jsx
import { useState } from 'react';

// Kuva tulee nyt /api/latest-pollauksen mukana (useTelemetry); ei omaa hookia.
export default function LatestImage({ imageUrl, loading }) {
  // Muistetaan mikä URL epäonnistui: kun kuva-URL vaihtuu, vertailu menee
  // automaattisesti epätodeksi eikä virhetilaa tarvitse erikseen nollata.
  const [brokenUrl, setBrokenUrl] = useState(null);

  if (loading && !imageUrl) return <div className="image-empty">LADATAAN…</div>;
  // Jos kuva on poistettu/vanhentunut tai sen lataus epäonnistuu, näytetään
  // sama "EI KUVIA" -tila rikkinäisen kuvakkeen sijaan.
  if (!imageUrl || brokenUrl === imageUrl) return <div className="image-empty">EI KUVIA</div>;

  return (
    <div className="latest-image-wrapper">
      <img
        src={imageUrl}
        alt="Viimeisin KitSat-kuva"
        className="latest-image"
        onError={() => setBrokenUrl(imageUrl)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire `imageUrl` through `App.jsx`.** Add `imageUrl` to the `useTelemetry` destructure at `src/App.jsx:73`:

```js
  const { telemetry, history, loading, error, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs, imageUrl } = useTelemetry();
```

- [ ] **Step 3: Pass the props** to `<LatestImage>` at `src/App.jsx:247`:

```jsx
              <LatestImage imageUrl={imageUrl} loading={loading} />
```

- [ ] **Step 4: Delete the now-unused hook**

```bash
git rm src/hooks/useLatestImage.js
```

- [ ] **Step 5: Confirm nothing else imports it**

Run: `grep -rn "useLatestImage" src/`
Expected: no output.

- [ ] **Step 6: Run lint + build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/components/LatestImage.jsx src/App.jsx
git commit -m "Fold latest image into snapshot poll; drop useLatestImage"
```

---

### Task 7: Remove the dead Supabase client + document the new architecture

**Files:**
- Delete: `src/supabaseClient.js`
- Modify: `CLAUDE.md`
- Modify: `.env.example`

**Interfaces:** none (cleanup + docs).

- [ ] **Step 1: Confirm the client is unused**

Run: `grep -rn "supabaseClient\|from '@supabase/supabase-js'" src/`
Expected: no output (Tasks 5–6 removed both importers).

- [ ] **Step 2: Delete it**

```bash
git rm src/supabaseClient.js
```

- [ ] **Step 3: Update `.env.example`** — append a section documenting the server-side Pages env vars (keep the existing `VITE_` block; it is now only relevant if other code still reads it):

```
# ── Cloudflare Pages Functions (server-side, set in the Pages dashboard) ──
# The dashboard now reads telemetry through /api/history and /api/latest, which
# run as Pages Functions. Set these in Cloudflare Pages → Settings → Environment
# variables for BOTH Production and Preview (no VITE_ prefix — they are not
# exposed to the browser):
# SUPABASE_URL=https://your-project-ref.supabase.co
# SUPABASE_ANON_KEY=your-anon-public-key
# SUPABASE_TABLE=your_table_name
```

- [ ] **Step 4: Update `CLAUDE.md`.** Replace the `## Environment` section body and the `### Telemetry` / `### Images` architecture bullets to describe the snapshot model. Specifically:

In `## Environment`, replace the paragraph with:

```markdown
The browser no longer talks to Supabase directly. Two Cloudflare Pages Functions
(`functions/api/history.js`, `functions/api/latest.js`) read Supabase server-side
and serve edge-cached JSON snapshots; the app fetches `/api/history` once on load
and polls `/api/latest` every ~4 s. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_TABLE` as **Pages environment variables** (server-side, no `VITE_`
prefix) in the Cloudflare dashboard for Production and Preview. The anon key is
public and read-only; access control still relies on Supabase RLS (anon read-only
on the telemetry table and `camera` Storage bucket).
```

Under `### Telemetry — src/hooks/useTelemetry.js`, replace the opening with:

```markdown
The heart of the app. It fetches `/api/history` once (full cleaned flight history)
then polls `/api/latest` every ~4 s (recent rows + latest image URL). The bad-data
cleaning now lives **server-side** in `functions/_shared/clean.js` (single source
of truth), shared by both Functions via `functions/_shared/snapshot.js`. The hook
still derives `status` from data freshness, detects a new flight when a polled
row's `flight_id` changes (any change → it re-fetches `/api/history` for the new
flight's full track), and keeps the "newest `created_at`, not highest `flight_id`"
invariant — now enforced in `functions/_shared/supabase.js`.
```

Under `### Images`, replace the paragraph with:

```markdown
The latest image URL is resolved **server-side** in `functions/_shared/supabase.js`
(`fetchLatestImageUrl`: scan every `camera` folder, pick the globally newest by
`created_at`, never by folder-name sort) and returned in the `/api/latest` payload.
`src/components/LatestImage.jsx` is a pure presentational component taking
`imageUrl` + `loading` props — there is no separate image-polling hook.
```

Add a new bullet to the architecture intro noting the Functions layer (after the data/presentation split sentence):

```markdown
A third **edge layer** (`functions/`) sits between the app and Supabase: Pages
Functions that build cached snapshots so Supabase load no longer scales with
viewer count. See `docs/superpowers/specs/2026-06-25-edge-cached-snapshot-design.md`
for the rationale and the documented R2 upgrade path for tens-of-thousands of viewers.
```

- [ ] **Step 5: Run lint + build + check**

Run: `npm run lint && npm run build && npm run check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Drop dead Supabase client; document snapshot architecture"
```

---

## Post-implementation (handed to user — outside this plan's automated scope)

These require Cloudflare dashboard access and a real deploy; they are **verify/ops**, not code:

1. **Set Pages env vars** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TABLE`) for Production + Preview, or the Functions return `503`.
2. **Confirm caching vs. Functions quota:** verify that edge cache *hits* are served without counting against the Pages Functions request quota (the spec's open question). If raw Function invocations approach free-tier limits at the target scale, enable **Workers/Pages Paid (~$5/mo)**. Optionally add a Cloudflare **Cache Rule** for `/api/*` so repeat edge hits skip the Function entirely.
3. **Confirm Supabase load is flat** in the Supabase dashboard regardless of how many tabs are open (the whole point of this change).
4. **Realtime cleanup (optional):** the frontend no longer subscribes to Broadcast, so the `docs/broadcast-migration.sql` trigger is no longer required by the app. Leave or remove at the backend owner's discretion.

## Notes on the documented upgrade path (not built here)

If poll volume against Cloudflare (not Supabase) ever becomes the binding limit, move the read path to static files in R2 written by a scheduled job (Cron Worker for `/history`, Durable Object alarm for `/latest`), served by the CDN without invoking a Function. The JSON contracts (`{flightId, startMs, rows}` and `{flightId, rows, imageUrl}`) stay identical, so the frontend is untouched. See the design spec.
