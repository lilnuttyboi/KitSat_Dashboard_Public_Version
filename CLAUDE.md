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

Requires a `.env` (copy `.env.example`) with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SUPABASE_TABLE`. `src/supabaseClient.js` throws on startup if the URL or key is missing. The anon key is public in the browser; access control relies entirely on Supabase RLS — anon must be read-only on the telemetry table and the `camera` Storage bucket.

## Architecture

The app splits into a **data layer** (`src/hooks/`) and a **presentation layer** (`src/components/`, `src/App.jsx`). The complexity lives in the data layer.

### Telemetry — `src/hooks/useTelemetry.js`
The heart of the app. On mount it:
1. Picks the current flight by the **newest `created_at` row, not the highest `flight_id`** — flight numbering is not chronological, and this invariant recurs throughout the hook.
2. Paginates that flight's full history (1000 rows/page), selecting only the columns the UI needs.
3. Subscribes to Supabase Realtime `INSERT`s. The subscription opens immediately, but incoming rows are **buffered until the initial load finishes** so nothing is lost or overwritten. A new flight is detected when a realtime row's `flight_id` differs from the current one (any change, even a lower number). Connection `status` is derived from both the subscription state and data freshness (a stale-data timer).

**Bad-data cleaning** (understand before removing): sentinel rows (`temp 0 / pressure 1013.25 / no fix`) are dropped; GPS speeds > 300 m/s are nulled; coordinates at Null Island or jumping > 150 km between consecutive samples are invalidated (`gps_fix → false`) so the map doesn't draw a line to Africa. `withCleanFix` mutates a shared "last good coordinate" container so the jump check stays continuous across the initial load and the realtime stream.

### Images — `src/hooks/useLatestImage.js`
Polls the `camera` Storage bucket, where each flight has its own folder (`<flight_id>/cap_*.jpg`). A cheap single-folder poll runs every 5 s; a full scan across all folders (to catch a new flight's folder) runs every 60 s. The globally newest image is chosen by `created_at`, never by folder-name sort.

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
