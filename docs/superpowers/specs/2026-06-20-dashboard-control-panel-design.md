# Dashboard Control Panel, Cinematic Camera & Satellite Basemap — Design

**Date:** 2026-06-20
**Status:** Approved (design), pending spec review

## Goal

Add a hide-able floating **control window** to the public dashboard that steers the
map: switch the basemap to realistic **satellite imagery**, pick a **cinematic camera
mode** (all tracking the satellite), and reset the view — moving the reset action out
of the map itself. The window also flips a one-click **maintenance mode** that covers
the whole public dashboard with a branded Pori Space Lab splash, so the operator can
hide it instantly while fixing something and unhide it just as fast.

## Architecture (one sentence each)

- The window's state is lifted into `App.jsx` and passed down to `Globe3D` (3D) and
  `MapComponent` (2D); the window sits beside the map and steers it through props.
- All work is **presentation-layer only** — `src/hooks/useTelemetry.js`, the data
  cleaning, Supabase, and the camera/image polling are **untouched**.

## Tech Stack

React 19 + Vite, recharts (unchanged here), Leaflet / react-leaflet (2D), CesiumJS
1.124 loaded tokenless from CDN (3D), CSS custom properties for theming. No new
dependencies.

## Global Constraints

- **Presentation-only.** Do NOT modify `src/hooks/useTelemetry.js` or any data-layer
  logic, cleaning, or Supabase access. No telemetry-shape changes.
- **All UI strings and code comments in Finnish.** Match the existing style.
- **Tokenless.** No Cesium Ion token, no Esri API key — public tile endpoints only.
- **Anon Supabase key is public**; access control is RLS. Nothing here changes that.
- Verify with `npm run lint` and `npm run build` only (no test suite; no browser in
  env — visual confirmation is handed to the user).
- Stay on branch `nuutti`. Do not push. Finnish commit messages are not required;
  end commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## Current State (what exists today)

- `App.jsx` owns `mapMode` (`'3d' | '2d'`, default `'3d'`) and renders either
  `Globe3D` or `MapComponent`. The 2D/3D toggle is an overlay on the map card.
- The **"Palauta näkymä"** reset button currently lives *inside* `Globe3D`
  (`.globe-reset-btn`, bottom-right of the globe) and calls `flyToSidePose()`.
- `Globe3D` has a single hard-coded camera pose (`VIEW_HEADING_DEG = 35`,
  `VIEW_PITCH_DEG = -4`, range `VIEW_BASE_RANGE + alt * 2.2`) re-applied every frame
  in a `scene.preRender` handler when `autoTrackRef.current` is true. Touching the
  canvas (`pointerdown`/`wheel`) stops tracking.
- Basemaps are flat CARTO tiles: `dark_all` (dark theme, heavily brightened) and
  `voyager` (light theme), in **both** Leaflet and Cesium. Dark tiles are brightened
  via CSS (`.leaflet-container .leaflet-tile-pane { filter: brightness(2.4)… }`) in 2D
  and `layer.brightness = 2.0` in 3D (`cartoLayer`).

---

## Feature 1 — Floating control window (`OHJAUS`)

### Behavior
- New component **`src/components/ControlPanel.jsx`**. A `position: fixed` floating
  window, **visible by default**, rendered above the map (z-index above the map
  overlays, i.e. > 500).
- **Draggable** by its title bar using pointer events: `pointerdown` on the title bar
  captures the pointer; `pointermove` updates an `{x, y}` position in component state;
  position is **clamped** so the window stays within the viewport; `pointerup`
  releases. The final position is persisted to `localStorage` under key
  `controlPanelPos` and read back on mount (default: top-right, below the header).
- **×** button in the title bar hides the window (`App` sets `panelOpen = false`).
- When hidden, `App` renders a small **⚙ launcher button** (`.control-launcher`,
  fixed top-right) that reopens it.
- Public: it is part of the normal dashboard render — every viewer sees it; the only
  control is show/hide + drag. No auth.

### Contents (Finnish labels)
- Title bar: `OHJAUS` + `×`.
- **Pohjakartta** section: two buttons — `Satelliitti` | `Kartta` (segmented, active
  state via existing `.range-btn.active`). Applies to both 2D and 3D.
- **Kamera** section: three mode buttons — `Sivu` | `Kierto` | `Ylhäältä` — plus a
  separate **`Lento`** action button. This whole section is **disabled / greyed when
  `mapMode === '2d'`** (camera modes are 3D-only); a short Finnish note explains why.
- **`Palauta näkymä`** button (full-width).
- **Huolto** section: a **`Huoltotila`** toggle button (active/highlighted when on).
  Turning it on shows the maintenance splash over the whole dashboard (Feature 4);
  turning it off restores the dashboard. This is the operator's hide/unhide switch.

### Props
```
ControlPanel({
  basemap,            // 'satellite' | 'kartta'
  onBasemapChange,    // (value) => void
  cameraMode,         // 'sivu' | 'kierto' | 'ylha'
  onCameraModeChange, // (value) => void
  onReset,            // () => void   -> bumps resetNonce in App
  onFlyover,          // () => void   -> bumps flyoverNonce in App
  maintenance,        // boolean      -> highlights the Huoltotila toggle
  onMaintenanceToggle,// () => void   -> App flips maintenance
  mapMode,            // '3d' | '2d'  -> disables camera section in 2d
  onClose,            // () => void   -> App sets panelOpen=false
})
```
The window owns its own drag position (localStorage); `App` owns only open/closed.

---

## Feature 2 — Satellite basemap (default)

### Source (tokenless)
- Imagery: **Esri World Imagery** —
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
- Labels overlay (place names, so it is not bare imagery): **Esri reference** —
  `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`
- Attribution / credit string (both 2D and 3D):
  `Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community`
- `maximumLevel: 19` (matches the existing CARTO config).

### Default and switching
- `basemap` defaults to **`'satellite'`** — this is the fix for "the black map looks
  weird". `'kartta'` switches back to the existing theme-styled CARTO basemap
  (dark `dark_all` in dark theme, `voyager` in light theme — unchanged from today).
- `basemap` is App state, passed to **both** `Globe3D` and `MapComponent`.

### 2D (`MapComponent.jsx`)
- When `basemap === 'satellite'`: render the Esri World Imagery `TileLayer` plus the
  labels `TileLayer` overlay (`subdomains` not needed for Esri).
- When `basemap === 'kartta'`: render the existing CARTO `TileLayer` (theme-based).
- The brightness boost must NOT apply to satellite. Scope it: add a class on the map
  wrapper, e.g. `className={"map-wrapper" + (basemap === 'satellite' ? ' satellite' : '')}`,
  and override in CSS: `.map-wrapper.satellite .leaflet-tile-pane { filter: none; }`.
  The existing `filter: brightness(2.4)…` rule stays for the styled dark basemap.

### 3D (`Globe3D.jsx`)
- Refactor `cartoLayer(Cesium, theme)` into basemap construction that returns the
  right layer(s) for the active `basemap`:
  - `satellite`: a `UrlTemplateImageryProvider` for World Imagery (no brightness/
    contrast/saturation boost — true exposure) **plus** a second `ImageryLayer` for
    the labels reference tiles, added on top.
  - `kartta`: the existing CARTO layer with the current dark brightness boost.
- The theme-change effect and the new basemap-change effect both rebuild the imagery
  layers (`viewer.imageryLayers.removeAll(true)` then add). `basemap` is added to the
  effect deps. (When `satellite` is active, the OS/UI theme no longer affects the map
  tiles — only UI chrome.)

---

## Feature 3 — Cinematic camera modes (3D)

All modes lock onto the satellite (`craftPosRef`). Tuning constants stay at the top of
`Globe3D.jsx`. `cameraMode` is App state (default `'sivu'`); `Globe3D` reads it as a
prop and the `preRender` handler branches on the current mode (held in a ref so the
single long-lived `preRender` closure always sees the latest value).

### Constants
```
VIEW_HEADING_DEG = 35     // Sivu bearing
VIEW_PITCH_DEG   = -4     // Sivu pitch (current default)
VIEW_BASE_RANGE  = 4000
ORBIT_PITCH_DEG     = -20
ORBIT_DEG_PER_SEC   = 8    // full circle ~45 s
TOP_PITCH_DEG       = -89  // near-vertical (avoid gimbal at exactly -90)
TOP_HEADING_DEG     = 0
TOP_RANGE_FACTOR    = 1.5  // overhead sits a bit closer than the 2.2 side factor
FLYOVER_DURATION    = 4.0  // seconds
```

### Modes
- **`sivu`** (default) — current behavior: `HeadingPitchRange(35°, -4°, 4000 + alt*2.2)`,
  `camera.lookAt` each frame.
- **`kierto`** — orbit: pitch `ORBIT_PITCH_DEG`, range `4000 + alt*2.2`, heading
  advances over time. On entering orbit, store `orbitStart = viewer.clock.currentTime`;
  each `preRender` compute `elapsed = JulianDate.secondsDifference(currentTime, orbitStart)`
  and `heading = toRadians(VIEW_HEADING_DEG + ORBIT_DEG_PER_SEC * elapsed)`. (Cesium's
  viewer clock runs in real time by default.)
- **`ylha`** — top-down: `HeadingPitchRange(0°, -89°, 4000 + alt*TOP_RANGE_FACTOR)`.
- **`Lento` (fly-over action)** — not a persistent mode; triggered by `flyoverNonce`.
  On trigger: disable auto-tracking, `viewer.camera.flyToBoundingSphere` of the route's
  bounding sphere (`BoundingSphere.fromPoints(positionsRef.current)`; if the route is
  empty, fall back to a sphere around the craft) with a dramatic
  `HeadingPitchRange`, `duration = FLYOVER_DURATION`; on `complete`, re-enable
  tracking in the currently selected persistent `cameraMode`.

### Reset
- **`Palauta näkymä`** now lives in the control window. It bumps `resetNonce` in `App`;
  `Globe3D` watches `resetNonce` in an effect and re-frames the **current** camera mode
  on the craft (a mode-aware `flyTo`, re-enabling tracking) — replacing the old in-globe
  button. The old `.globe-reset-btn` and its in-component button are removed.
- Manual canvas interaction still stops tracking (unchanged); `Palauta näkymä` resumes
  it.

---

## Feature 4 — Maintenance mode ("hide the dashboard")

### Behavior
- New component **`src/components/MaintenanceOverlay.jsx`**: a full-viewport
  `position: fixed` splash that covers the entire dashboard (header + grid + map
  overlays) when `maintenance` is true. The dashboard keeps running underneath
  (data still updates); it is only visually covered — nothing is paused.
- Toggled from the control window's **Huoltotila** button (`maintenance` state in
  `App`, default `false`).
- **The control window and the ⚙ launcher sit *above* the maintenance splash** so the
  operator can always toggle it back off. Layering (z-index):
  dashboard/header (≤ 10) < map overlays (≤ 500) < maintenance splash (`1500`) <
  control window + launcher (`2000`). Consistent with the earlier decision that the
  control window is public.

### Look & copy (Finnish, dark/space-themed regardless of UI theme)
- Centered, dark space-themed background (matches the app's `--bg-color` / starfield
  feel); always dark like the header, even in light theme.
- **Logo:** the text `PORI SPACE LAB` rendered in the **display font** used by the main
  values (`--font-display`, Orbitron) — large (clamp sizing like `.value-large`),
  bright, wide letter-spacing. Plain text, no image asset.
- **Status line (Finnish):** `Huoltotauko käynnissä`.
- **Funny subtitle (Finnish):** `Ruuvataan vielä pari pulttia kiinni — palaamme pian.`
- A subtle touch (e.g., a slowly spinning ⚙ or a pulsing dot) is allowed for life;
  keep it lightweight. The three strings are isolated constants at the top of the
  component so they are trivial to edit later.

---

## State & Data Flow (`App.jsx`)

New state in `App`:
```
const [basemap, setBasemap]       = useState('satellite');
const [cameraMode, setCameraMode] = useState('sivu');
const [resetNonce, setResetNonce]   = useState(0);  // bump -> Globe3D re-frames
const [flyoverNonce, setFlyoverNonce] = useState(0); // bump -> Globe3D fly-over
const [panelOpen, setPanelOpen]   = useState(true);
const [maintenance, setMaintenance] = useState(false); // huoltotila: peittää näkymän
```
- `MaintenanceOverlay` renders at `App` top level (sibling of the control window),
  shown only when `maintenance` is true.
- `Globe3D` gains props: `basemap`, `cameraMode`, `resetNonce`, `flyoverNonce`
  (plus existing `lat/lng/alt/route3d/theme`).
- `MapComponent` gains prop: `basemap`.
- The control window and ⚙ launcher render at `App` top level (siblings of
  `.dashboard-container` content), `position: fixed`.

Deliberate **YAGNI / non-goals**:
- `basemap` and `cameraMode` are **not** persisted across reload (reset to defaults);
  only the window's drag position is persisted. Fly-over is on-demand, never the load
  default (the load default is `sivu`, matching today).
- 2D has no camera modes; `Palauta näkymä` and the camera section act on 3D only. 2D
  already auto-centers on the satellite via `MapEffects`.

---

## Files

- **Create:** `src/components/ControlPanel.jsx` — the floating window + drag logic.
- **Create:** `src/components/MaintenanceOverlay.jsx` — the Pori Space Lab splash.
- **Modify:** `src/App.jsx` — new state (incl. `maintenance`), render `ControlPanel`
  + launcher + `MaintenanceOverlay`, pass props.
- **Modify:** `src/components/Globe3D.jsx` — basemap construction, `cameraMode`
  branching in `preRender`, `resetNonce` / `flyoverNonce` effects, remove in-globe
  reset button.
- **Modify:** `src/components/MapComponent.jsx` — `basemap` prop, Esri satellite +
  labels layers, wrapper class for brightness scoping.
- **Modify:** `src/App.css` — `.control-window*`, `.control-launcher`,
  `.maintenance-overlay*` styles; scope the dark-tile brightness filter to the styled
  basemap only.

## Verification

- `npm run lint` clean, `npm run build` succeeds.
- Manual (handed to user): window drags/hides/reopens and persists position;
  satellite shows real forests/water in 2D and 3D and is the default; "Kartta" switches
  back; each camera mode tracks the satellite; "Lento" sweeps then resumes; "Palauta
  näkymä" re-frames; camera section greys out in 2D; **Huoltotila** covers the whole
  dashboard with the Pori Space Lab splash and the control window stays on top to
  toggle it back off.
