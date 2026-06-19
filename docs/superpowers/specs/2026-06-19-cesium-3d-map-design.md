# 3D Cesium globe map with auto-tracking camera — Design

**Date:** 2026-06-19
**Branch:** `nuutti` (backup `nuutti-backup` is frozen; do not touch it)
**Status:** Approved design, pending implementation plan

## 1. Summary

Add a second, switchable map to the dashboard: a **CesiumJS 3D globe** that shows
the flight trajectory and altitude, alongside the existing 2D Leaflet map. The
3D globe is the **default** view. A small on-map toggle switches between 2D and
3D. The 3D map **auto-tracks** the balloon with a slow, side-on "drone trail"
camera; the viewer can freely orbit/zoom, and a reset button snaps back to the
default tracking pose.

This is a **presentation-only** feature. It does **not** change the data layer
(`src/hooks/useTelemetry.js`), the data cleaning, or any telemetry semantics. It
only consumes what the telemetry hook already returns.

## 2. Decisions (locked)

| Topic | Decision |
| --- | --- |
| Camera motion | **Trail from the side** — fixed side angle, smoothly follows the balloon upward, no orbit/spin. |
| Globe imagery | **Tokenless** — CARTO basemaps (reuse the 2D map's tiles), no Cesium Ion account/token, no 3D world terrain (smooth ellipsoid globe). |
| Default map | **3D globe** on first load; 2D is one click away. |
| Library loading | **CDN script tags** (Cesium v1.124), but injected **on demand** by a loader module with error handling — not hard-coded into `index.html`. |
| Switching/reset controls | **On-map overlay** controls (not in the header), large and legible for the big-screen display. |
| Inactive map | **Unmounted** — only one map (one Cesium `Viewer`) alive at a time. |
| Altitude source | `gps_alt` (the schema has **no** barometric altitude; the friend's "use baro, not GPS" note does not apply here). |
| Altitude scale | True scale, no exaggeration (revisit only if it reads flat at ~30 km). |

## 3. Architecture

The feature splits into three units with clear boundaries:

### 3.1 `src/lib/loadCesium.js` (new)

A tiny module that loads the Cesium CDN bundle on demand.

- Sets `window.CESIUM_BASE_URL` to the v1.124 CDN base.
- Injects the `Widgets/widgets.css` `<link>` and the `Cesium.js` `<script>`
  **once** (idempotent — guards against double injection).
- Returns a **cached promise** that resolves with `window.Cesium` when the
  script has loaded, and **rejects** if the script fails to load (offline / CDN
  down).
- Knows nothing about telemetry, React, or the app. Pure loader.

**Interface:** `loadCesium(): Promise<typeof Cesium>`.

### 3.2 `src/components/Globe3D.jsx` (new, lazy-loaded)

A React component that owns exactly one Cesium `Viewer`. All comments and UI
strings in Finnish (project convention).

**Props:**
- `lat: number | null` — current craft latitude (null when no GPS fix)
- `lng: number | null` — current craft longitude (null when no GPS fix)
- `alt: number | null` — current craft altitude in metres (`gps_alt`)
- `route3d: { lat: number, lon: number, alt: number }[]` — full trajectory
- `theme: 'dark' | 'light'`

**Internals:**
- A container `<div>` ref filling the map cell.
- One mount effect that: awaits `loadCesium()`; constructs the `Viewer` with the
  tokenless config (see §5); creates the trajectory polyline, altitude curtain
  wall, and craft point entities (all backed by `Cesium.CallbackProperty` reading
  mutable refs); installs the auto-track camera handler and the
  interaction-pause listeners (see §6); and tears everything down on unmount
  (`viewer.destroy()`).
- Mutable refs `positionsRef` (Cartesian3[]) and `craftPosRef` (Cartesian3 | null)
  that the CallbackProperties read each frame, so prop updates do not trigger a
  React re-render of the Cesium scene.
- Effects that watch `route3d` (rebuild `positionsRef`) and `lat/lng/alt`
  (update `craftPosRef` and the craft `heightReference`).
- An effect that watches `theme` and swaps the imagery layer.
- Renders only the **reset** overlay button (3D-only). The 2D/3D toggle is
  rendered by the parent (`App.jsx`), because the inactive map unmounts and the
  toggle must persist across both modes — see §7.

`Globe3D` knows nothing about Supabase. It only renders the props it is given.

### 3.3 `src/App.jsx` (modified)

- New `mapMode` state, default `'3d'`.
- New `route3d` memo built from `history` (see §4), alongside the existing
  `route`.
- In the `grid-area: map` cell, render either `<Globe3D …>` or `<MapComponent …>`
  depending on `mapMode`, each wrapped in the existing `Suspense` pattern.
- The 2D/3D toggle control (on-map overlay) flips `mapMode`.

## 4. Data flow

- **Trajectory:** `route3d` is built the same way the existing 2D `route` is, but
  carrying altitude:
  ```js
  history
    .filter(h => h.fix && Number.isFinite(h.lat) && Number.isFinite(h.lon))
    .map(h => ({ lat: h.lat, lon: h.lon, alt: Number.isFinite(h.alt) ? h.alt : 0 }))
  ```
  Memoized on `history`.
- **Current craft:** passed from App like the 2D map already does —
  `lat={telemetry?.gps_fix ? telemetry.gps_lat : null}`, same for `lng`
  (`gps_lon`) and `alt` (`gps_alt`).
- Inside `Globe3D`, `route3d` → `positionsRef` as `Cartesian3.fromDegrees(lon, lat, alt)`;
  current craft → `craftPosRef`. The craft's `heightReference` flips to
  `CLAMP_TO_GROUND` below 150 m and `NONE` above (airborne) — mirrors the
  friend's `updateMap`.
- Like the 2D map, the 3D trajectory always shows the **full** flight. The
  1m/5m/30m/1h/MAX range buttons remain **charts-only** and do not affect either
  map.

## 5. Tokenless Cesium configuration

- Do **not** set a Cesium Ion token and do **not** use `Terrain.fromWorldTerrain()`.
- Construct the `Viewer` with the same chrome stripped as the friend's snippet
  (`baseLayerPicker`, `geocoder`, `homeButton`, `timeline`, `animation`,
  `navigationHelpButton`, `sceneModePicker`, `fullscreenButton`, `infoBox`,
  `selectionIndicator` all `false`), hide the Cesium credit container.
- Supply our **own** imagery via a CARTO `UrlTemplateImageryProvider` (dark vs
  light per theme), so Cesium never reaches for Ion's default world imagery.
- Smooth/quality-of-life settings from the snippet: disable collision detection,
  zero scroll/spin inertia, sensible min/max zoom distances,
  `globe.depthTestAgainstTerrain = false`.

> **Implementation risk to verify against Cesium 1.124 docs:** the exact way to
> start a Viewer with no Ion base layer (e.g. `baseLayer: false` / supplying our
> own `ImageryLayer`) and suppress the default Ion-token code path. This is the
> one API detail to confirm during the implementation plan, not invent.

## 6. Camera: default side view + slow auto-trail + reset

- **Default pose ("side view"):** camera offset a few km horizontally from the
  craft, pitched only slightly down (~ −12°), looking at the craft — so the
  audience sees the balloon against the sky with the amber trajectory and the
  altitude curtain descending to the ground. The offset distance scales with the
  trajectory extent so the whole track stays roughly framed.
- **Slow trail (auto-track ON):** a per-frame `scene.preRender` handler eases the
  camera toward the desired pose each frame with a small interpolation factor →
  very slow, smooth "drone keeping pace" motion, **no spin**. As the balloon
  rises, the target rises and the camera follows.
- **Free control:** normal Cesium mouse orbit/zoom/pan stays enabled. The moment
  the user starts interacting (mouse-down / wheel), auto-track turns **OFF** so we
  do not fight the user.
- **Reset:** a Finnish **"Palauta näkymä"** button re-enables auto-track and
  `camera.flyTo`s back to the default side pose over ~1.5 s. The first GPS fix
  also triggers an initial fly-to (like the friend's snippet).
- **Tuning:** offset distance, pitch angle, ease factor, and fly durations are
  feel-dependent and will be tuned live in `npm run dev` during verification.
  This is the one part expected to need iteration.

## 7. Visuals, theming, and switching UI

- **Trajectory polyline:** amber `#fbbf24` (matches the existing 2D route), width
  3, geodesic arc.
- **Altitude curtain:** translucent amber `wall` under the trajectory
  (flight-radar look), ~0.12 alpha.
- **Craft:** bright cyan point `#35d6e6`, white outline; `CLAMP_TO_GROUND` when
  grounded, true altitude when airborne.
- **Theming:** swap the globe imagery layer with the `theme` prop — CARTO
  `dark_all` (dark) ⇄ `voyager` (light), mirroring the 2D map's `TILE_URLS`.
  Globe base color / atmosphere tuned per theme.
- **Switching control:** a compact **2D / 3D** segmented toggle reusing the
  `.range-btn` styling, rendered as a **large, legible on-map overlay** in a
  corner of the map cell.
- **Reset control:** the **"Palauta näkymä"** button shows only in 3D mode, as a
  second on-map overlay control.
- **Layout:** both maps share the `grid-area: map` cell; the Cesium container
  fills it at 100% height like Leaflet. The inactive map **unmounts** (one
  `Viewer` alive at a time → frees GPU/memory). The CDN script stays cached after
  first load, so re-switching to 3D is fast.
- **Loading/error states:** `Globe3D` is `React.lazy` + `Suspense` with a Finnish
  "Ladataan 3D-karttaa…" fallback. If `loadCesium()` rejects (CDN failure), show
  a Finnish error message pointing the viewer to the 2D map.

## 8. Build & verification

- **No new npm dependencies** (CDN approach); `index.html` is unchanged (tags are
  injected at runtime).
- Verify with `npm run lint` and `npm run build` (no test suite per CLAUDE.md).
- Manual check in `npm run dev`:
  1. Dashboard opens on the 3D globe by default.
  2. Trajectory polyline + altitude curtain render along the flight path.
  3. Craft point sits at the latest fix; clamps to ground when grounded, rises
     when airborne.
  4. Camera slow-trails the balloon from the side, no spin.
  5. Dragging/zooming overrides auto-track; **"Palauta näkymä"** snaps back.
  6. 2D/3D toggle switches maps; switching back to 3D is fast.
  7. Theme toggle swaps the globe imagery (dark ⇄ light).
  8. Simulated CDN failure shows the Finnish fallback message, not a blank panel.

## 9. Out of scope

- Any change to telemetry fetching, cleaning, or the realtime subscription.
- 3D world terrain / satellite imagery / Cesium Ion (explicitly rejected:
  tokenless).
- Altitude exaggeration (flagged for later only if true scale reads flat).
- Time-range filtering of the map track (stays charts-only, unchanged).
- Pushing to any remote; this work stays local on `nuutti` for now.
