# Dashboard Control Panel, Cinematic Camera & Satellite Basemap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hide-able, draggable floating control window to the public dashboard that switches the map to satellite imagery, picks a cinematic 3D camera mode (all tracking the satellite), resets the view, and flips a Pori Space Lab maintenance splash.

**Architecture:** Lift the window's state into `App.jsx` and pass it down to `Globe3D` (3D) and `MapComponent` (2D). Two new presentational components (`ControlPanel`, `MaintenanceOverlay`) render at `App` top level as fixed-position siblings. The data layer is untouched.

**Tech Stack:** React 19 + Vite 8, Leaflet / react-leaflet (2D), CesiumJS 1.124 from CDN (3D), CSS custom properties. No new dependencies.

## Global Constraints

- **Presentation-only.** Do NOT modify `src/hooks/useTelemetry.js` or any data-layer logic, cleaning, or Supabase access. No telemetry-shape changes.
- **All UI strings and code comments in Finnish.** Match the existing style.
- **Tokenless.** No Cesium Ion token, no Esri API key — public tile endpoints only.
- **No test suite exists** (per CLAUDE.md). Each task is verified by `npm run lint` (must report **no errors** — pre-existing `exhaustive-deps` warnings are acceptable) and `npm run build` (must succeed), plus a described manual visual check handed to the user. Do NOT add a test framework.
- **Lint gotchas to respect:** `no-unused-vars` is an error → never introduce a binding (incl. a `useState` setter) before the step that uses it; destructure value-only (`const [x] = useState(...)`) until a setter is needed. `no-empty` is an error → no empty `catch {}`; use `catch (e) { void e; }`.
- recharts gotcha (unchanged here): `YAxis width={0}` hides tick labels.
- Stay on branch `nuutti`. Do not push. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## File Structure

- **Create** `src/components/ControlPanel.jsx` — the floating window: drag logic + control sections.
- **Create** `src/components/MaintenanceOverlay.jsx` — the full-screen Pori Space Lab splash.
- **Modify** `src/App.jsx` — lifted state, render the new components, pass props.
- **Modify** `src/components/Globe3D.jsx` — basemap construction, camera-mode branching, reset/fly-over effects, remove in-globe reset button.
- **Modify** `src/components/MapComponent.jsx` — `basemap` prop, Esri satellite + labels layers, wrapper class for brightness scoping.
- **Modify** `src/App.css` — control-window/launcher/maintenance styles; scope the dark-tile brightness filter to the styled basemap only.

**Task order (linear, each builds on the last):**
1. Satellite basemap in 2D + `basemap` state in App.
2. Satellite basemap in 3D (Globe3D).
3. Cinematic camera modes + reset/fly-over plumbing (Globe3D) + App state.
4. Floating control window (ControlPanel) wired into App; remove in-globe reset button.
5. Maintenance mode (MaintenanceOverlay + Huolto toggle).

---

## Task 1: Satellite basemap in 2D + `basemap` state

**Files:**
- Modify: `src/App.jsx` (add `basemap` state; pass to `MapComponent`)
- Modify: `src/components/MapComponent.jsx` (full rewrite below)
- Modify: `src/App.css` (append one rule)

**Interfaces:**
- Produces: App state `basemap` (`'satellite' | 'kartta'`, default `'satellite'`); `MapComponent` prop `basemap` with the same values.

- [ ] **Step 1: Rewrite `src/components/MapComponent.jsx`** with the full content below.

```jsx
import { memo, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

const BALLOON_SVG = `
<svg viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="16" cy="15" rx="13" ry="14" fill="#fbbf24" stroke="#0b0f1a" stroke-width="1.5"/>
  <path d="M14 28 L13 32 M18 28 L19 32" stroke="#0b0f1a" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <line x1="16" y1="29" x2="16" y2="34" stroke="#0b0f1a" stroke-width="1.5"/>
  <rect x="11" y="34" width="10" height="7" fill="#0b0f1a" stroke="#fbbf24" stroke-width="1" rx="1"/>
</svg>
`;

const balloonIcon = L.divIcon({
  className: 'balloon-marker',
  html: BALLOON_SVG,
  iconSize: [32, 44],
  iconAnchor: [16, 41],
  popupAnchor: [0, -36],
});

const DEFAULT_CENTER = [60.1695, 24.9354];

// "Kartta"-pohja: teemoitetut CARTO-tiilet (tumma kirkastetaan App.css:ssä).
const TILE_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};

// "Satelliitti"-pohja: Esri World Imagery (tokeniton) + ohut paikannimikerros,
// jotta kuvassa näkyy metsät, vedet ja oikea maasto — ei mustaa karttaa.
const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community';

function MapEffects({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    if (lat == null || lng == null) return;
    const c = map.getCenter();
    if (c.lat === lat && c.lng === lng) return;
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

const MapComponent = memo(({ lat, lng, route = [], theme = 'dark', basemap = 'satellite' }) => {
  const hasValidCoords = lat != null && lng != null;
  // Keskipiste kiinnitetään mount-hetkellä; näkymää siirtää MapEffects.
  const [initialCenter] = useState(() => (hasValidCoords ? [lat, lng] : DEFAULT_CENTER));
  const markerPosition = useMemo(() => [lat ?? 0, lng ?? 0], [lat, lng]);
  const showRoute = route.length >= 2;
  const isSatellite = basemap === 'satellite';

  return (
    <div className={`map-wrapper${isSatellite ? ' satellite' : ''}`}>
      <MapContainer
        center={initialCenter}
        zoom={13}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
      >
        {isSatellite ? (
          <>
            <TileLayer key="sat" attribution={ESRI_ATTRIBUTION} url={SATELLITE_URL} maxZoom={19} />
            <TileLayer key="sat-labels" url={SATELLITE_LABELS_URL} maxZoom={19} />
          </>
        ) : (
          <TileLayer
            key={theme}
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url={TILE_URLS[theme] ?? TILE_URLS.dark}
            subdomains="abcd"
          />
        )}
        {showRoute && (
          <Polyline positions={route} pathOptions={{ color: '#fbbf24', weight: 3, opacity: 0.9 }} />
        )}
        {hasValidCoords && (
          <Marker position={markerPosition} icon={balloonIcon}>
            <Popup>
              KitSatin nykyinen sijainti <br />
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </Popup>
          </Marker>
        )}
        <MapEffects lat={lat} lng={lng} />
      </MapContainer>
    </div>
  );
});

export default MapComponent;
```

- [ ] **Step 2: Add `basemap` state to `src/App.jsx`.** After the `mapMode` line:

Find:
```jsx
  const [mapMode, setMapMode] = useState('3d'); // '3d' = oletus (näyttävin yleisölle)
```
Add immediately below (value-only — the setter arrives in Task 4, so it stays lint-clean now):
```jsx
  const [basemap] = useState('satellite'); // 'satellite' | 'kartta'
```

- [ ] **Step 3: Pass `basemap` to `MapComponent` in `src/App.jsx`.**

Find:
```jsx
                <MapComponent
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  route={route}
                  theme={theme}
                />
```
Replace with:
```jsx
                <MapComponent
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  route={route}
                  theme={theme}
                  basemap={basemap}
                />
```

- [ ] **Step 4: Scope the brightness filter in `src/App.css`.** Append at the end of the file:

```css
/* Satelliittipohja on jo oikein valotettu — ei CARTO-tummalle tarkoitettua
   kirkastusta. Korkeampi spesifisyys kumoaa yllä olevan brightness-suotimen. */
.map-wrapper.satellite .leaflet-tile-pane {
  filter: none;
}
```

- [ ] **Step 5: Lint.** Run: `npm run lint` — Expected: no errors.
- [ ] **Step 6: Build.** Run: `npm run build` — Expected: `✓ built in …`, exit 0.
- [ ] **Step 7: Manual check (hand to user).** In 2D mode the map now shows real satellite imagery (forests green, water blue) at true exposure (not washed out), with place-name labels. The 3D map still looks as before (changed in Task 2).
- [ ] **Step 8: Commit.**

```bash
git add src/App.jsx src/components/MapComponent.jsx src/App.css
git commit -m "Add satellite basemap to 2D map + basemap state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Satellite basemap in 3D (Globe3D)

**Files:**
- Modify: `src/components/Globe3D.jsx` (5 precise edits below)
- Modify: `src/App.jsx` (pass `basemap` to `Globe3D`)

**Interfaces:**
- Consumes: App state `basemap` (Task 1).
- Produces: `Globe3D` prop `basemap` (`'satellite' | 'kartta'`, default `'satellite'`); helper `applyBasemap(Cesium, viewer, basemap, theme)`.

- [ ] **Step 1: Add Esri imagery constants.** In `src/components/Globe3D.jsx`, find:

```jsx
// CARTO-karttapohja teeman mukaan — sama lähde kuin 2D-kartalla. Cesium ei tue
// {r}-retina-merkintää, joten se jätetään pois.
const CARTO_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
};
```
Replace with:
```jsx
// "Kartta"-pohja: teemoitetut CARTO-tiilet. Cesium ei tue {r}-merkintää.
const CARTO_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
};

// "Satelliitti"-pohja: Esri World Imagery (tokeniton) + ohut paikannimikerros.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT = 'Esri, Maxar, Earthstar Geographics, and the GIS User Community';
```

- [ ] **Step 2: Replace `cartoLayer` with basemap builders.** Find:

```jsx
// Rakentaa teeman mukaisen CARTO-kuvakerroksen.
function cartoLayer(Cesium, theme) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: CARTO_URLS[theme] ?? CARTO_URLS.dark,
    subdomains: 'abcd',
    credit: '© CARTO © OpenStreetMap contributors',
    maximumLevel: 19,
  });
  const layer = new Cesium.ImageryLayer(provider);
  // Tumma CARTO on lähes musta — kirkastetaan kuten 2D-kartalla CSS:llä.
  if (theme === 'dark') {
    layer.brightness = 2.0;
    layer.contrast = 1.1;
    layer.saturation = 1.3;
  }
  return layer;
}
```
Replace with:
```jsx
// Rakentaa valitun pohjakartan kuvakerrokset. Satelliitti = kuva + nimikerros
// (ei kirkastusta, oikea valotus); kartta = teemoitettu CARTO (tumma kirkastetaan).
function buildBasemapLayers(Cesium, basemap, theme) {
  if (basemap === 'satellite') {
    const imagery = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: SATELLITE_URL,
        maximumLevel: 19,
        credit: ESRI_CREDIT,
      })
    );
    const labels = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: SATELLITE_LABELS_URL,
        maximumLevel: 19,
      })
    );
    return [imagery, labels];
  }
  const layer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: CARTO_URLS[theme] ?? CARTO_URLS.dark,
      subdomains: 'abcd',
      credit: '© CARTO © OpenStreetMap contributors',
      maximumLevel: 19,
    })
  );
  if (theme === 'dark') {
    layer.brightness = 2.0;
    layer.contrast = 1.1;
    layer.saturation = 1.3;
  }
  return [layer];
}

// Vaihtaa näkyvät kuvakerrokset valitun pohjakartan mukaan.
function applyBasemap(Cesium, viewer, basemap, theme) {
  viewer.imageryLayers.removeAll(true);
  for (const layer of buildBasemapLayers(Cesium, basemap, theme)) {
    viewer.imageryLayers.add(layer);
  }
}
```

- [ ] **Step 3: Add the `basemap` prop.** Find:

```jsx
function Globe3D({ lat, lng, alt, route3d = [], theme = 'dark' }) {
```
Replace with:
```jsx
function Globe3D({ lat, lng, alt, route3d = [], theme = 'dark', basemap = 'satellite' }) {
```

- [ ] **Step 4: Use `baseLayer: false` + `applyBasemap` at viewer creation.**

Find:
```jsx
          // Tokeniton: oma CARTO-kuvakerros, ei Ion-maailmankuvaa eikä maastoa.
          baseLayer: cartoLayer(Cesium, theme),
```
Replace with:
```jsx
          // Tokeniton: oma kuvakerros (satelliitti tai CARTO), ei Ion-oletusta.
          baseLayer: false,
```
Then find:
```jsx
        viewerRef.current = viewer;

        viewer.scene.globe.depthTestAgainstTerrain = false;
```
Replace with:
```jsx
        viewerRef.current = viewer;

        applyBasemap(Cesium, viewer, basemap, theme);

        viewer.scene.globe.depthTestAgainstTerrain = false;
```

- [ ] **Step 5: Rebuild layers on basemap/theme change.** Find:

```jsx
  // Vaihda karttapohja teeman mukaan.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    viewer.imageryLayers.removeAll(true);
    viewer.imageryLayers.add(cartoLayer(Cesium, theme));
  }, [theme, status]);
```
Replace with:
```jsx
  // Vaihda pohjakartta tai teema.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    applyBasemap(Cesium, viewer, basemap, theme);
  }, [basemap, theme, status]);
```

- [ ] **Step 6: Pass `basemap` to `Globe3D` in `src/App.jsx`.** Find:

```jsx
                <Globe3D
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  alt={telemetry?.gps_fix ? telemetry.gps_alt : null}
                  route3d={route3d}
                  theme={theme}
                />
```
Replace with:
```jsx
                <Globe3D
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  alt={telemetry?.gps_fix ? telemetry.gps_alt : null}
                  route3d={route3d}
                  theme={theme}
                  basemap={basemap}
                />
```

- [ ] **Step 7: Lint.** Run: `npm run lint` — Expected: no errors (the pre-existing `exhaustive-deps` disable on the init effect still covers `basemap`/`theme`).
- [ ] **Step 8: Build.** Run: `npm run build` — Expected: `✓ built in …`, exit 0.
- [ ] **Step 9: Manual check (hand to user).** The 3D globe now shows satellite imagery by default, matching the 2D map — real terrain, no heavy brightening. The "Palauta näkymä" button still works (still in the globe corner; it moves out in Task 4).
- [ ] **Step 10: Commit.**

```bash
git add src/components/Globe3D.jsx src/App.jsx
git commit -m "Add satellite basemap to 3D globe (Esri World Imagery, tokenless)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Cinematic camera modes + reset/fly-over plumbing (Globe3D)

**Files:**
- Modify: `src/components/Globe3D.jsx` (full rewrite below — supersedes Task 2's file)
- Modify: `src/App.jsx` (add `cameraMode`/`resetNonce`/`flyoverNonce` state; pass to `Globe3D`)

**Interfaces:**
- Consumes: App state `basemap` (Task 1/2).
- Produces: `Globe3D` props `cameraMode` (`'sivu' | 'kierto' | 'ylha'`, default `'sivu'`), `resetNonce` (number, default `0`), `flyoverNonce` (number, default `0`). Bumping `resetNonce` re-frames the current mode; bumping `flyoverNonce` plays the fly-over. App state added value-only here (setters arrive in Task 4).

- [ ] **Step 1: Rewrite `src/components/Globe3D.jsx`** with the full content below. (This keeps the in-globe "Palauta näkymä" button for now — Task 4 removes it once the control window provides reset.)

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCesium } from '../lib/loadCesium';

// "Kartta"-pohja: teemoitetut CARTO-tiilet. Cesium ei tue {r}-merkintää.
const CARTO_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
};

// "Satelliitti"-pohja: Esri World Imagery (tokeniton) + ohut paikannimikerros.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT = 'Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const ROUTE_COLOR = '#fbbf24'; // sama keltainen kuin 2D-reitti / korkeuskäyrä
const CRAFT_COLOR = '#35d6e6'; // satelliittipisteen syaani

const GROUND_CLAMP_LIMIT = 150; // m — tämän alapuolella dotti naulataan maahan

// Kamerakulmat asteina (Cesium.Math ei ole käytettävissä moduulin latautuessa).
const VIEW_HEADING_DEG = 35;   // Sivu-tilan sivukulma
const VIEW_PITCH_DEG = -4;     // Sivu-tilan loiva alaspäin
const VIEW_BASE_RANGE = 4000;  // m, vähimmäisetäisyys kohteeseen
const ORBIT_PITCH_DEG = -20;   // Kierto: katsekulma
const ORBIT_DEG_PER_SEC = 8;   // Kierto: täysi kierros ~45 s
const TOP_PITCH_DEG = -89;     // Ylhäältä: lähes suoraan alas (ei tasan -90)
const TOP_HEADING_DEG = 0;     // Ylhäältä: pohjoinen ylös
const TOP_RANGE_FACTOR = 1.5;  // Ylhäältä istuu hieman lähempänä kuin sivu (2.2)
const FLYOVER_DURATION = 4.0;  // Lento-animaation kesto sekunteina

// Sivu/Kierto: etäisyys kasvaa korkeuden mukana, jotta korkeusverho pysyy kuvassa.
function viewRange(altMeters) {
  return VIEW_BASE_RANGE + (Number.isFinite(altMeters) ? altMeters : 0) * 2.2;
}

// Kameran asento valitulle tilalle (kohde = satelliitti).
function poseForMode(Cesium, mode, altMeters) {
  const alt = Number.isFinite(altMeters) ? altMeters : 0;
  if (mode === 'kierto') {
    return new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(VIEW_HEADING_DEG),
      Cesium.Math.toRadians(ORBIT_PITCH_DEG),
      viewRange(alt)
    );
  }
  if (mode === 'ylha') {
    return new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(TOP_HEADING_DEG),
      Cesium.Math.toRadians(TOP_PITCH_DEG),
      VIEW_BASE_RANGE + alt * TOP_RANGE_FACTOR
    );
  }
  return new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(VIEW_HEADING_DEG),
    Cesium.Math.toRadians(VIEW_PITCH_DEG),
    viewRange(alt)
  );
}

// Rakentaa valitun pohjakartan kuvakerrokset. Satelliitti = kuva + nimikerros
// (ei kirkastusta, oikea valotus); kartta = teemoitettu CARTO (tumma kirkastetaan).
function buildBasemapLayers(Cesium, basemap, theme) {
  if (basemap === 'satellite') {
    const imagery = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: SATELLITE_URL,
        maximumLevel: 19,
        credit: ESRI_CREDIT,
      })
    );
    const labels = new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: SATELLITE_LABELS_URL,
        maximumLevel: 19,
      })
    );
    return [imagery, labels];
  }
  const layer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: CARTO_URLS[theme] ?? CARTO_URLS.dark,
      subdomains: 'abcd',
      credit: '© CARTO © OpenStreetMap contributors',
      maximumLevel: 19,
    })
  );
  if (theme === 'dark') {
    layer.brightness = 2.0;
    layer.contrast = 1.1;
    layer.saturation = 1.3;
  }
  return [layer];
}

// Vaihtaa näkyvät kuvakerrokset valitun pohjakartan mukaan.
function applyBasemap(Cesium, viewer, basemap, theme) {
  viewer.imageryLayers.removeAll(true);
  for (const layer of buildBasemapLayers(Cesium, basemap, theme)) {
    viewer.imageryLayers.add(layer);
  }
}

// Muuntaa reittipisteet Cartesian3-taulukoksi.
function toCartesians(Cesium, route3d) {
  return route3d
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Number.isFinite(p.alt) ? p.alt : 0)
    );
}

function Globe3D({
  lat,
  lng,
  alt,
  route3d = [],
  theme = 'dark',
  basemap = 'satellite',
  cameraMode = 'sivu',
  resetNonce = 0,
  flyoverNonce = 0,
}) {
  const containerRef = useRef(null);
  const cesiumRef = useRef(null);       // window.Cesium
  const viewerRef = useRef(null);
  const craftEntityRef = useRef(null);
  const positionsRef = useRef([]);      // Cesium.Cartesian3[]
  const craftPosRef = useRef(null);     // Cesium.Cartesian3 | null
  const altRef = useRef(0);             // viimeisin korkeus kameran etäisyyttä varten
  const autoTrackRef = useRef(false);   // seuraako kamera satelliittia
  const didFirstFlyRef = useRef(false);
  const cameraModeRef = useRef(cameraMode); // preRender lukee aina tuoreimman tilan
  const orbitStartRef = useRef(null);       // Cesium.JulianDate: kierron alkuhetki
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // Lentää valitun kameratilan asentoon ja kytkee seurannan päälle.
  // Käytetään ensimmäisellä fixillä, "Palauta näkymä" -toiminnolla ja napilla.
  const flyToCurrentPose = useCallback(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    if (cameraModeRef.current === 'kierto') {
      orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
    }
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(craftPosRef.current, 1), {
      offset: poseForMode(Cesium, cameraModeRef.current, altRef.current),
      duration: 1.5,
      complete: () => {
        autoTrackRef.current = true;
      },
    });
  }, []);

  // Alusta Cesium-viewer kerran.
  useEffect(() => {
    let cancelled = false;

    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;

        const viewer = new Cesium.Viewer(containerRef.current, {
          // Tokeniton: oma kuvakerros (satelliitti tai CARTO), ei Ion-oletusta.
          baseLayer: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          timeline: false,
          animation: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
        });
        viewerRef.current = viewer;

        applyBasemap(Cesium, viewer, basemap, theme);

        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.cesiumWidget.creditContainer.style.display = 'none';

        // Pehmeämpi zoom/pyöritys, ei inertiaa.
        const sscc = viewer.scene.screenSpaceCameraController;
        sscc.enableCollisionDetection = false;
        sscc.inertiaSpin = 0;
        sscc.inertiaTranslate = 0;
        sscc.minimumZoomDistance = 30;
        sscc.maximumZoomDistance = 4.0e7;

        // Lentorata (keltainen viiva).
        viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => positionsRef.current, false),
            width: 3,
            arcType: Cesium.ArcType.GEODESIC,
            material: Cesium.Color.fromCssColorString(ROUTE_COLOR),
          },
        });
        // Korkeusverho (flightradar-tyyli).
        viewer.entities.add({
          wall: {
            positions: new Cesium.CallbackProperty(() => positionsRef.current, false),
            material: Cesium.Color.fromCssColorString(ROUTE_COLOR).withAlpha(0.12),
          },
        });
        // Satelliittipiste.
        craftEntityRef.current = viewer.entities.add({
          position: new Cesium.CallbackProperty(() => craftPosRef.current, false),
          point: {
            pixelSize: 12,
            color: Cesium.Color.fromCssColorString(CRAFT_COLOR),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });

        // Seuranta: joka ruudulla kamera asetetaan valitun tilan mukaan
        // satelliitin ympärille. HeadingPitchRange luodaan kerran ja sen arvot
        // päivittyvät tilan ja korkeuden mukana (vältetään GC-paine).
        const trackHpr = new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(VIEW_HEADING_DEG),
          Cesium.Math.toRadians(VIEW_PITCH_DEG),
          VIEW_BASE_RANGE
        );
        viewer.scene.preRender.addEventListener(() => {
          if (!autoTrackRef.current || !craftPosRef.current) return;
          const mode = cameraModeRef.current;
          const a = altRef.current;
          if (mode === 'kierto') {
            const elapsed = orbitStartRef.current
              ? Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, orbitStartRef.current)
              : 0;
            trackHpr.heading = Cesium.Math.toRadians(VIEW_HEADING_DEG + ORBIT_DEG_PER_SEC * elapsed);
            trackHpr.pitch = Cesium.Math.toRadians(ORBIT_PITCH_DEG);
            trackHpr.range = viewRange(a);
          } else if (mode === 'ylha') {
            trackHpr.heading = Cesium.Math.toRadians(TOP_HEADING_DEG);
            trackHpr.pitch = Cesium.Math.toRadians(TOP_PITCH_DEG);
            trackHpr.range = VIEW_BASE_RANGE + (Number.isFinite(a) ? a : 0) * TOP_RANGE_FACTOR;
          } else {
            trackHpr.heading = Cesium.Math.toRadians(VIEW_HEADING_DEG);
            trackHpr.pitch = Cesium.Math.toRadians(VIEW_PITCH_DEG);
            trackHpr.range = viewRange(a);
          }
          viewer.camera.lookAt(craftPosRef.current, trackHpr);
        });

        // Kun käyttäjä koskee karttaan, seuranta lopetetaan (ei taistella vastaan).
        const stopTracking = () => {
          if (!autoTrackRef.current) return;
          autoTrackRef.current = false;
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        };
        viewer.scene.canvas.addEventListener('pointerdown', stopTracking);
        viewer.scene.canvas.addEventListener('wheel', stopTracking, { passive: true });

        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
    // theme/basemap luetaan tarkoituksella vain alustuksessa; muutokset hoidetaan
    // erillisessä efektissä alla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Päivitä lentorata kun route3d muuttuu (vasta kun viewer on valmis).
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!Cesium || status !== 'ready') return;
    positionsRef.current = toCartesians(Cesium, route3d);
  }, [route3d, status]);

  // Päivitä satelliitin sijainti + korkeusviittaus kun lat/lng/alt muuttuu.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!Cesium || status !== 'ready') return;
    if (lat == null || lng == null) {
      craftPosRef.current = null;
      return;
    }
    const h = Number.isFinite(alt) ? alt : 0;
    altRef.current = h;
    craftPosRef.current = Cesium.Cartesian3.fromDegrees(lng, lat, h);
    if (craftEntityRef.current) {
      craftEntityRef.current.point.heightReference =
        h > GROUND_CLAMP_LIMIT
          ? Cesium.HeightReference.NONE
          : Cesium.HeightReference.CLAMP_TO_GROUND;
    }
    // Ensimmäisellä fixillä lennetään valitun tilan näkymään ja kytketään seuranta.
    if (!didFirstFlyRef.current) {
      didFirstFlyRef.current = true;
      flyToCurrentPose();
    }
  }, [lat, lng, alt, status, flyToCurrentPose]);

  // Vaihda pohjakartta tai teema.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    applyBasemap(Cesium, viewer, basemap, theme);
  }, [basemap, theme, status]);

  // Pidä kameratila tuoreena preRenderille; kierto alkaa alusta tilaan tultaessa,
  // ja tilan valinta jatkaa seurantaa (käyttäjän tahto seurata).
  useEffect(() => {
    cameraModeRef.current = cameraMode;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    if (cameraMode === 'kierto') {
      orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
    }
    if (craftPosRef.current) autoTrackRef.current = true;
  }, [cameraMode, status]);

  // "Palauta näkymä": kehystä nykyinen kameratila uudelleen satelliittiin.
  useEffect(() => {
    if (resetNonce === 0) return; // ei laukaista ensirenderissä
    flyToCurrentPose();
  }, [resetNonce, flyToCurrentPose]);

  // "Lento": pyyhkäise koko reitin yli ja palaa seurantaan valittuun tilaan.
  useEffect(() => {
    if (flyoverNonce === 0) return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    const positions = positionsRef.current;
    const sphere =
      positions.length >= 2
        ? Cesium.BoundingSphere.fromPoints(positions)
        : new Cesium.BoundingSphere(craftPosRef.current, VIEW_BASE_RANGE);
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(VIEW_HEADING_DEG),
        Cesium.Math.toRadians(-30),
        sphere.radius * 2.5
      ),
      duration: FLYOVER_DURATION,
      complete: () => {
        if (cameraModeRef.current === 'kierto') {
          orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
        }
        autoTrackRef.current = true;
      },
    });
  }, [flyoverNonce]);

  return (
    <div className="globe-wrapper">
      <div ref={containerRef} className="globe-canvas" />
      {status === 'loading' && (
        <div className="globe-overlay">LADATAAN 3D-KARTTAA…</div>
      )}
      {status === 'error' && (
        <div className="globe-overlay">
          3D-KARTAN LATAUS EPÄONNISTUI.
          <br />
          KÄYTÄ 2D-KARTTAA.
        </div>
      )}
      {status === 'ready' && (
        <button
          className="range-btn globe-reset-btn"
          onClick={flyToCurrentPose}
          title="Palauta seuraava sivunäkymä"
        >
          Palauta näkymä
        </button>
      )}
    </div>
  );
}

export default Globe3D;
```

- [ ] **Step 2: Add camera state to `src/App.jsx`.** Find:

```jsx
  const [basemap] = useState('satellite'); // 'satellite' | 'kartta'
```
Replace with:
```jsx
  const [basemap] = useState('satellite'); // 'satellite' | 'kartta'
  const [cameraMode] = useState('sivu');   // 'sivu' | 'kierto' | 'ylha' (vain 3D)
  const [resetNonce] = useState(0);        // bump -> Globe3D kehystää uudelleen
  const [flyoverNonce] = useState(0);      // bump -> Globe3D lentää reitin yli
```

- [ ] **Step 3: Pass the camera props to `Globe3D` in `src/App.jsx`.** Find:

```jsx
                <Globe3D
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  alt={telemetry?.gps_fix ? telemetry.gps_alt : null}
                  route3d={route3d}
                  theme={theme}
                  basemap={basemap}
                />
```
Replace with:
```jsx
                <Globe3D
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  alt={telemetry?.gps_fix ? telemetry.gps_alt : null}
                  route3d={route3d}
                  theme={theme}
                  basemap={basemap}
                  cameraMode={cameraMode}
                  resetNonce={resetNonce}
                  flyoverNonce={flyoverNonce}
                />
```

- [ ] **Step 4: Lint.** Run: `npm run lint` — Expected: no errors. (`cameraMode`/`resetNonce`/`flyoverNonce` are all consumed as props; the reset/fly-over effects include their nonce in deps; the `flyoverNonce` effect uses only refs otherwise.)
- [ ] **Step 5: Build.** Run: `npm run build` — Expected: `✓ built in …`, exit 0.
- [ ] **Step 6: Manual check (hand to user).** Default 3D behavior is unchanged (side-chase tracking). The new modes aren't reachable yet (no UI until Task 4), but the default `'sivu'` path tracks as before and the in-globe "Palauta näkymä" still re-frames. No console errors on load.
- [ ] **Step 7: Commit.**

```bash
git add src/components/Globe3D.jsx src/App.jsx
git commit -m "Add cinematic 3D camera modes + reset/fly-over plumbing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Floating control window (ControlPanel) wired into App

**Files:**
- Create: `src/components/ControlPanel.jsx` (full content below)
- Modify: `src/App.jsx` (import; upgrade state to include setters + `panelOpen`; render window + launcher; wrap return in a fragment)
- Modify: `src/components/Globe3D.jsx` (remove the in-globe reset button)
- Modify: `src/App.css` (append control-window + launcher styles)

**Interfaces:**
- Consumes: App state `basemap`, `cameraMode`, `resetNonce`, `flyoverNonce` (Tasks 1–3), `mapMode` (existing).
- Produces: `ControlPanel` component with the prop signature shown below. The window owns its own drag position (persisted to `localStorage` key `controlPanelPos`); `App` owns open/closed via `panelOpen`.

- [ ] **Step 1: Create `src/components/ControlPanel.jsx`** with the full content below.

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';

const POS_KEY = 'controlPanelPos';
const PANEL_W = 240; // px — leveys reunarajausta ja oletussijaintia varten

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// Lue tallennettu sijainti; oletus oikeaan yläkulmaan otsikon alapuolelle.
function readPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch (e) {
    void e; // viallinen tai estetty tallennus — käytetään oletusta
  }
  return { x: Math.max(16, window.innerWidth - PANEL_W - 24), y: 88 };
}

function writePos(pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch (e) {
    void e; // tallennus voi olla estetty (yksityinen tila) — ei kriittistä
  }
}

export default function ControlPanel({
  basemap,
  onBasemapChange,
  cameraMode,
  onCameraModeChange,
  onReset,
  onFlyover,
  mapMode,
  onClose,
}) {
  const [pos, setPos] = useState(readPos);
  const panelRef = useRef(null);
  const dragRef = useRef(null); // { dx, dy }: osoittimen ja ikkunan kulman ero

  const onPointerDown = useCallback((e) => {
    const rect = panelRef.current?.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - (rect?.left ?? 0), dy: e.clientY - (rect?.top ?? 0) };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const w = panelRef.current?.offsetWidth ?? PANEL_W;
    const h = panelRef.current?.offsetHeight ?? 0;
    setPos({
      x: clamp(e.clientX - dragRef.current.dx, 0, window.innerWidth - w),
      y: clamp(e.clientY - dragRef.current.dy, 0, window.innerHeight - h),
    });
  }, []);

  const endDrag = useCallback((e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      void err; // osoitin saattaa olla jo vapautettu
    }
  }, []);

  // Tallenna sijainti kun se muuttuu (säilyy myös sulkemisen ja latauksen yli).
  useEffect(() => {
    writePos(pos);
  }, [pos]);

  const is2d = mapMode === '2d';

  return (
    <div ref={panelRef} className="control-window" style={{ left: pos.x, top: pos.y }}>
      <div
        className="control-titlebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="control-title">OHJAUS</span>
        <button
          className="control-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label="Piilota ohjauspaneeli"
          title="Piilota"
        >
          ×
        </button>
      </div>

      <div className="control-body">
        <div className="control-section">
          <span className="control-label">Pohjakartta</span>
          <div className="control-row">
            <button
              className={`range-btn${basemap === 'satellite' ? ' active' : ''}`}
              onClick={() => onBasemapChange('satellite')}
            >
              Satelliitti
            </button>
            <button
              className={`range-btn${basemap === 'kartta' ? ' active' : ''}`}
              onClick={() => onBasemapChange('kartta')}
            >
              Kartta
            </button>
          </div>
        </div>

        <div className={`control-section${is2d ? ' disabled' : ''}`}>
          <span className="control-label">Kamera</span>
          <div className="control-row">
            <button
              className={`range-btn${cameraMode === 'sivu' ? ' active' : ''}`}
              onClick={() => onCameraModeChange('sivu')}
              disabled={is2d}
            >
              Sivu
            </button>
            <button
              className={`range-btn${cameraMode === 'kierto' ? ' active' : ''}`}
              onClick={() => onCameraModeChange('kierto')}
              disabled={is2d}
            >
              Kierto
            </button>
            <button
              className={`range-btn${cameraMode === 'ylha' ? ' active' : ''}`}
              onClick={() => onCameraModeChange('ylha')}
              disabled={is2d}
            >
              Ylhäältä
            </button>
          </div>
          <button className="range-btn control-wide" onClick={onFlyover} disabled={is2d}>
            Lento
          </button>
          {is2d && <span className="control-hint">Kameratilat ovat käytössä vain 3D-kartalla.</span>}
        </div>

        <button className="range-btn control-wide" onClick={onReset} disabled={is2d}>
          Palauta näkymä
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Import `ControlPanel` in `src/App.jsx`.** Find:

```jsx
import LatestImage from './components/LatestImage';
import FlightTimer from './components/FlightTimer';
import './App.css';
```
Replace with:
```jsx
import LatestImage from './components/LatestImage';
import FlightTimer from './components/FlightTimer';
import ControlPanel from './components/ControlPanel';
import './App.css';
```

- [ ] **Step 3: Upgrade the lifted state to include setters + `panelOpen`.** Find:

```jsx
  const [basemap] = useState('satellite'); // 'satellite' | 'kartta'
  const [cameraMode] = useState('sivu');   // 'sivu' | 'kierto' | 'ylha' (vain 3D)
  const [resetNonce] = useState(0);        // bump -> Globe3D kehystää uudelleen
  const [flyoverNonce] = useState(0);      // bump -> Globe3D lentää reitin yli
```
Replace with:
```jsx
  const [basemap, setBasemap] = useState('satellite');   // 'satellite' | 'kartta'
  const [cameraMode, setCameraMode] = useState('sivu');  // 'sivu' | 'kierto' | 'ylha'
  const [resetNonce, setResetNonce] = useState(0);       // bump -> Globe3D kehystää uudelleen
  const [flyoverNonce, setFlyoverNonce] = useState(0);   // bump -> Globe3D lentää reitin yli
  const [panelOpen, setPanelOpen] = useState(true);      // ohjauspaneelin näkyvyys
```

- [ ] **Step 4: Wrap the return in a fragment and render the window + launcher.** Find:

```jsx
  return (
    <div className="dashboard-container">
```
Replace with:
```jsx
  return (
    <>
    <div className="dashboard-container">
```
Then find the end of the return:
```jsx
      </main>
    </div>
  );
}
```
Replace with:
```jsx
      </main>
    </div>
    {panelOpen ? (
      <ControlPanel
        basemap={basemap}
        onBasemapChange={setBasemap}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        onReset={() => setResetNonce((n) => n + 1)}
        onFlyover={() => setFlyoverNonce((n) => n + 1)}
        mapMode={mapMode}
        onClose={() => setPanelOpen(false)}
      />
    ) : (
      <button
        className="control-launcher"
        onClick={() => setPanelOpen(true)}
        aria-label="Avaa ohjauspaneeli"
        title="Avaa ohjauspaneeli"
      >
        ⚙
      </button>
    )}
    </>
  );
}
```

- [ ] **Step 5: Remove the in-globe reset button from `src/components/Globe3D.jsx`** (reset now lives in the control window). Find and delete:

```jsx
      {status === 'ready' && (
        <button
          className="range-btn globe-reset-btn"
          onClick={flyToCurrentPose}
          title="Palauta seuraava sivunäkymä"
        >
          Palauta näkymä
        </button>
      )}
```
(`flyToCurrentPose` remains used by the first-fly and reset effects, so this leaves no unused binding.)

- [ ] **Step 6: Append control-window styles to `src/App.css`.**

```css
/* ── Ohjauspaneeli (kelluva, raahattava ikkuna) ────────────────────────
   Aina tumma pohja (kuten yläpalkki), joten värit kovakoodataan eikä
   sidota teemamuuttujiin (jotka vaalealla muuttuisivat mustiksi). */
.control-window {
  position: fixed;
  z-index: 2000;
  width: 240px;
  background: rgba(11, 15, 26, 0.92);
  backdrop-filter: var(--glass);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  box-shadow: var(--shadow-lg);
  color: #f1f5f9;
  user-select: none;
}
.control-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  cursor: move;
  touch-action: none; /* salli vetely myös kosketuksella */
}
.control-title {
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.15em;
}
.control-close {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}
.control-close:hover {
  color: #fff;
}
.control-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
}
.control-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.control-section.disabled {
  opacity: 0.5;
}
.control-label {
  font-family: var(--font-display);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #94a3b8;
  text-transform: uppercase;
}
.control-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.control-row .range-btn {
  flex: 1;
}
.control-wide {
  width: 100%;
}
.control-hint {
  font-family: var(--font-sans);
  font-size: 0.65rem;
  line-height: 1.4;
  color: #94a3b8;
}

/* Paneelin napit tummalla pohjalla — kirkkaat värit molemmissa teemoissa. */
.control-window .range-btn {
  color: #94a3b8;
  border-color: rgba(255, 255, 255, 0.18);
}
.control-window .range-btn:hover {
  color: #fff;
  border-color: #fff;
}
.control-window .range-btn.active {
  color: #fbbf24;
  border-color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
}
.control-window .range-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.control-window .range-btn:disabled:hover {
  color: #94a3b8;
  border-color: rgba(255, 255, 255, 0.18);
}

/* Avausnappi kun paneeli on piilotettu. */
.control-launcher {
  position: fixed;
  top: 88px;
  right: 24px;
  z-index: 2000;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  background: rgba(11, 15, 26, 0.92);
  backdrop-filter: var(--glass);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: #f1f5f9;
  cursor: pointer;
}
.control-launcher:hover {
  border-color: #fff;
}
```

- [ ] **Step 7: Lint.** Run: `npm run lint` — Expected: no errors. (All new setters are used; `void e` keeps catch blocks non-empty.)
- [ ] **Step 8: Build.** Run: `npm run build` — Expected: `✓ built in …`, exit 0.
- [ ] **Step 9: Manual check (hand to user).** The "OHJAUS" window shows top-right by default. It drags by the title bar and stays within the screen; **×** hides it and the **⚙** launcher reopens it at the saved position (persists across reload). "Satelliitti/Kartta" switches the basemap in both 2D and 3D. In 3D, "Sivu/Kierto/Ylhäältä" change the camera (all keep tracking the satellite), "Lento" sweeps the track then resumes, and "Palauta näkymä" re-frames. In 2D the Kamera section + Palauta are greyed out with the hint. The in-globe reset button is gone.
- [ ] **Step 10: Commit.**

```bash
git add src/components/ControlPanel.jsx src/App.jsx src/components/Globe3D.jsx src/App.css
git commit -m "Add floating control window (basemap, camera modes, reset, fly-over)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Maintenance mode (Pori Space Lab splash)

**Files:**
- Create: `src/components/MaintenanceOverlay.jsx` (full content below)
- Modify: `src/components/ControlPanel.jsx` (add `maintenance`/`onMaintenanceToggle` props + Huolto section)
- Modify: `src/App.jsx` (import; add `maintenance` state; pass props; render overlay)
- Modify: `src/App.css` (append maintenance styles)

**Interfaces:**
- Consumes: `ControlPanel` (Task 4).
- Produces: App state `maintenance` (boolean, default `false`); `MaintenanceOverlay` component (no props); `ControlPanel` gains props `maintenance` (boolean) and `onMaintenanceToggle` (`() => void`).

- [ ] **Step 1: Create `src/components/MaintenanceOverlay.jsx`** with the full content below.

```jsx
// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Kolme tekstiä on eristetty vakioiksi, jotta niitä on helppo muokata.
const LOGO = 'PORI SPACE LAB';
const STATUS = 'Huoltotauko käynnissä';
const FUNNY = 'Ruuvataan vielä pari pulttia kiinni — palaamme pian.';

export default function MaintenanceOverlay() {
  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <div className="maintenance-gear" aria-hidden="true">⚙</div>
        <h1 className="maintenance-logo">{LOGO}</h1>
        <p className="maintenance-status">{STATUS}</p>
        <p className="maintenance-funny">{FUNNY}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the maintenance props to `ControlPanel`.** In `src/components/ControlPanel.jsx`, find:

```jsx
export default function ControlPanel({
  basemap,
  onBasemapChange,
  cameraMode,
  onCameraModeChange,
  onReset,
  onFlyover,
  mapMode,
  onClose,
}) {
```
Replace with:
```jsx
export default function ControlPanel({
  basemap,
  onBasemapChange,
  cameraMode,
  onCameraModeChange,
  onReset,
  onFlyover,
  maintenance,
  onMaintenanceToggle,
  mapMode,
  onClose,
}) {
```

- [ ] **Step 3: Add the Huolto section to `ControlPanel`.** Find:

```jsx
        <button className="range-btn control-wide" onClick={onReset} disabled={is2d}>
          Palauta näkymä
        </button>
      </div>
    </div>
  );
}
```
Replace with:
```jsx
        <button className="range-btn control-wide" onClick={onReset} disabled={is2d}>
          Palauta näkymä
        </button>

        <div className="control-section">
          <span className="control-label">Huolto</span>
          <button
            className={`range-btn control-wide${maintenance ? ' active' : ''}`}
            onClick={onMaintenanceToggle}
          >
            {maintenance ? 'Lopeta huoltotila' : 'Huoltotila'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Import `MaintenanceOverlay` in `src/App.jsx`.** Find:

```jsx
import ControlPanel from './components/ControlPanel';
import './App.css';
```
Replace with:
```jsx
import ControlPanel from './components/ControlPanel';
import MaintenanceOverlay from './components/MaintenanceOverlay';
import './App.css';
```

- [ ] **Step 5: Add `maintenance` state to `src/App.jsx`.** Find:

```jsx
  const [panelOpen, setPanelOpen] = useState(true);      // ohjauspaneelin näkyvyys
```
Replace with:
```jsx
  const [panelOpen, setPanelOpen] = useState(true);      // ohjauspaneelin näkyvyys
  const [maintenance, setMaintenance] = useState(false); // huoltotila: peittää näkymän
```

- [ ] **Step 6: Pass maintenance props + render the overlay in `src/App.jsx`.** Find:

```jsx
      <ControlPanel
        basemap={basemap}
        onBasemapChange={setBasemap}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        onReset={() => setResetNonce((n) => n + 1)}
        onFlyover={() => setFlyoverNonce((n) => n + 1)}
        mapMode={mapMode}
        onClose={() => setPanelOpen(false)}
      />
    ) : (
      <button
        className="control-launcher"
        onClick={() => setPanelOpen(true)}
        aria-label="Avaa ohjauspaneeli"
        title="Avaa ohjauspaneeli"
      >
        ⚙
      </button>
    )}
    </>
```
Replace with:
```jsx
      <ControlPanel
        basemap={basemap}
        onBasemapChange={setBasemap}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        onReset={() => setResetNonce((n) => n + 1)}
        onFlyover={() => setFlyoverNonce((n) => n + 1)}
        maintenance={maintenance}
        onMaintenanceToggle={() => setMaintenance((m) => !m)}
        mapMode={mapMode}
        onClose={() => setPanelOpen(false)}
      />
    ) : (
      <button
        className="control-launcher"
        onClick={() => setPanelOpen(true)}
        aria-label="Avaa ohjauspaneeli"
        title="Avaa ohjauspaneeli"
      >
        ⚙
      </button>
    )}
    {maintenance && <MaintenanceOverlay />}
    </>
```

- [ ] **Step 7: Append maintenance styles to `src/App.css`.**

```css
/* ── Huoltoruutu (Pori Space Lab -splash) ──────────────────────────────
   Aina tumma/avaruusteema riippumatta käyttöliittymän teemasta; värit
   kovakoodataan, ettei vaalea teema tee tekstistä mustaa tummalla pohjalla.
   z-index 1500 < ohjauspaneelin 2000, joten paneelilla pääsee pois. */
.maintenance-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  background:
    radial-gradient(circle at 50% 38%, rgba(80, 100, 180, 0.14) 0%, transparent 55%),
    #04060f;
  color: #f1f5f9;
}
.maintenance-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  max-width: 40rem;
}
.maintenance-gear {
  font-size: clamp(2rem, 5vw, 3.5rem);
  color: #fbbf24;
  animation: maint-spin 6s linear infinite;
}
@keyframes maint-spin {
  to {
    transform: rotate(360deg);
  }
}
.maintenance-logo {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 7vw, 5rem);
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 0.95;
  color: #fff;
}
.maintenance-status {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(0.9rem, 2vw, 1.4rem);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #fbbf24;
}
.maintenance-funny {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(0.85rem, 1.6vw, 1.1rem);
  color: #94a3b8;
}
@media (prefers-reduced-motion: reduce) {
  .maintenance-gear {
    animation: none;
  }
}
```

- [ ] **Step 8: Lint.** Run: `npm run lint` — Expected: no errors.
- [ ] **Step 9: Build.** Run: `npm run build` — Expected: `✓ built in …`, exit 0.
- [ ] **Step 10: Manual check (hand to user).** The control window has a "Huolto" section. Clicking **Huoltotila** covers the whole dashboard with the dark Pori Space Lab splash (logo in the Orbitron value font, "Huoltotauko käynnissä", the funny line, a slowly spinning ⚙). The control window stays on top of the splash; the button now reads "Lopeta huoltotila" and turns it back off. Works the same in light and dark UI themes. The data underneath keeps updating while hidden.
- [ ] **Step 11: Commit.**

```bash
git add src/components/MaintenanceOverlay.jsx src/components/ControlPanel.jsx src/App.jsx src/App.css
git commit -m "Add maintenance mode (Pori Space Lab splash) to control window

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (author checklist, completed)

**Spec coverage:**
- Floating draggable/closable window, public, visible by default → Task 4 (ControlPanel + launcher; `localStorage` position).
- Satellite basemap (Esri), default, switchable to "Kartta", labels overlay, brightness scoping → Tasks 1 (2D) + 2 (3D).
- Camera modes Sivu/Kierto/Ylhäältä + Lento action, all tracking, reset re-frames, default `sivu` → Task 3 (logic) + Task 4 (UI). Reset moved out of the map → Task 4 removes the in-globe button.
- Camera section greys out in 2D → Task 4.
- Maintenance mode with Pori Space Lab splash, control window stays on top (z-index 2000 > 1500), Finnish strings + funny line → Task 5.
- No data-layer changes; Finnish throughout; tokenless; verify via lint + build → Global Constraints + every task's steps.

**Placeholder scan:** none — every step has complete code and exact commands.

**Type/name consistency:** `basemap` (`'satellite'|'kartta'`), `cameraMode` (`'sivu'|'kierto'|'ylha'`), `resetNonce`/`flyoverNonce` (numbers), `applyBasemap`/`buildBasemapLayers`/`poseForMode`/`flyToCurrentPose`, `controlPanelPos`, and the `ControlPanel`/`Globe3D` prop names match across all tasks. The `useState` value-only→setter upgrade (Tasks 1/3 → 4) is explicit and keeps `no-unused-vars` satisfied at every step.
