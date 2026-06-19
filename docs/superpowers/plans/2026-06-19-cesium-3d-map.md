# 3D Cesium Globe Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchable CesiumJS 3D globe map (default view) beside the existing 2D Leaflet map, showing the flight trajectory + altitude curtain, with a slow side-trailing auto-track camera the viewer can override and reset.

**Architecture:** A runtime CDN loader (`loadCesium.js`) lazily fetches Cesium v1.124. A lazy-loaded `Globe3D.jsx` owns one tokenless Cesium `Viewer` (CARTO imagery, no Ion), renders the trajectory/curtain/craft via `CallbackProperty`-backed entities, and drives a per-frame side-trail camera. `App.jsx` adds a `mapMode` toggle that swaps between `Globe3D` and the existing `MapComponent` in the same grid cell. Presentation-only — the telemetry data layer is untouched.

**Tech Stack:** React 19, Vite 8, CesiumJS 1.124 (CDN), existing CARTO basemaps. No new npm dependencies.

## Global Constraints

Every task implicitly includes these (copied from the spec / CLAUDE.md):

- **All code comments and UI strings in Finnish.** Match existing style.
- **No test suite.** Verify every task with `npm run lint` and `npm run build`; UI behaviour is verified manually in `npm run dev`. (This is why the steps below are not red-green-refactor TDD — the repo has no test runner.)
- **Presentation-only.** Do NOT modify `src/hooks/useTelemetry.js`, `src/hooks/useLatestImage.js`, or any data cleaning.
- **Tokenless Cesium.** Do NOT set `Cesium.Ion.defaultAccessToken`; do NOT call `Cesium.Terrain.fromWorldTerrain()` or use any Ion asset. Supply our own `baseLayer`.
- **Cesium version pinned to `1.124`** via the CDN URL.
- **Altitude source is `gps_alt` only** (no barometric field exists).
- **Route downsampling cap `ROUTE_MAX_POINTS = 2000`** is shared between the 2D and 3D routes.
- **`Cesium.Math.toRadians()` must not run at module load** (Cesium is undefined until the CDN script resolves) — store angles as plain degree numbers and convert inside functions that run after load.
- **Stay local on branch `nuutti`.** Do NOT push. Do NOT touch `nuutti-backup`.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/loadCesium.js` *(new)* | Idempotent, cached, on-demand CDN loader for Cesium 1.124; resolves `window.Cesium` or rejects. | 1 |
| `src/components/Globe3D.jsx` *(new)* | Owns one Cesium Viewer; renders trajectory/curtain/craft; side-trail camera + reset; loading/error states. | 2 |
| `src/App.css` *(modify)* | Globe wrapper/overlay/reset CSS (Task 2); map-mode toggle CSS (Task 3). | 2, 3 |
| `src/App.jsx` *(modify)* | `route3d` memo (shared downsampler), `mapMode` state, 2D/3D switch + toggle overlay. | 3 |

---

### Task 1: Cesium CDN loader (`src/lib/loadCesium.js`)

**Files:**
- Create: `src/lib/loadCesium.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadCesium(): Promise<typeof window.Cesium>` — resolves with the global `Cesium` once the CDN script has loaded; rejects with an `Error` (Finnish message) on load failure. Cached: repeated calls return the same in-flight/resolved promise; a failed load clears the cache so a later call can retry.

- [ ] **Step 1: Write the loader module**

Create `src/lib/loadCesium.js`:

```javascript
// Lataa CesiumJS:n CDN-niput pyynnöstä (vasta kun 3D-karttaa tarvitaan).
// Pidetään promise välimuistissa, jotta skripti injektoidaan vain kerran.
// Versio on lukittu, jotta build ei yllättäen muutu.
const CESIUM_VERSION = '1.124';
const BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;

let cesiumPromise = null;

export function loadCesium() {
  if (cesiumPromise) return cesiumPromise;

  cesiumPromise = new Promise((resolve, reject) => {
    // Jo ladattu (esim. takaisin 3D-tilaan vaihdettaessa).
    if (window.Cesium) {
      resolve(window.Cesium);
      return;
    }

    // Cesium tarvitsee tämän löytääkseen omat työntekijä-/asset-tiedostonsa.
    window.CESIUM_BASE_URL = BASE_URL;

    // Widgets-tyylit (vain kerran).
    if (!document.querySelector('link[data-cesium]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${BASE_URL}Widgets/widgets.css`;
      link.dataset.cesium = 'true';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = `${BASE_URL}Cesium.js`;
    script.async = true;
    script.dataset.cesium = 'true';
    script.onload = () => {
      if (window.Cesium) resolve(window.Cesium);
      else reject(new Error('Cesium latautui mutta window.Cesium puuttuu'));
    };
    script.onerror = () => {
      cesiumPromise = null; // Salli uudelleenyritys CDN-virheen jälkeen.
      reject(new Error('Cesiumin lataus epäonnistui'));
    };
    document.head.appendChild(script);
  });

  return cesiumPromise;
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors. (ESLint flat config; `window` and `document` are browser globals already allowed by the React app config.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, `dist/` produced, no Rollup errors. (The module is not imported yet, so this only checks it parses.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/loadCesium.js
git commit -m "$(cat <<'EOF'
Add on-demand Cesium CDN loader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 3D globe component (`src/components/Globe3D.jsx` + CSS)

**Files:**
- Create: `src/components/Globe3D.jsx`
- Modify: `src/App.css` (append globe/overlay/reset styles)

**Interfaces:**
- Consumes: `loadCesium()` from Task 1.
- Produces: `default export Globe3D` — a component with props
  `lat: number|null`, `lng: number|null`, `alt: number|null`,
  `route3d: {lat:number, lon:number, alt:number}[]`, `theme: 'dark'|'light'`.
  Renders `.globe-wrapper > .globe-canvas`; shows `.globe-overlay` while
  loading / on error; shows a `.range-btn.globe-reset-btn` ("Palauta näkymä")
  when ready.

- [ ] **Step 1: Write the Globe3D component**

Create `src/components/Globe3D.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCesium } from '../lib/loadCesium';

// CARTO-karttapohja teeman mukaan — sama lähde kuin 2D-kartalla. Cesium ei tue
// {r}-retina-merkintää, joten se jätetään pois.
const CARTO_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
};

const ROUTE_COLOR = '#fbbf24'; // sama keltainen kuin 2D-reitti / korkeuskäyrä
const CRAFT_COLOR = '#35d6e6'; // satelliittipisteen syaani

const GROUND_CLAMP_LIMIT = 150; // m — tämän alapuolella dotti naulataan maahan

// Kamerakulmat asteina (Cesium.Math ei ole käytettävissä moduulin latautuessa,
// joten muunnos radiaaneiksi tehdään vasta käyttökohdassa). Säädä makuun.
const VIEW_HEADING_DEG = 35;   // sivukulma
const VIEW_PITCH_DEG = -12;    // hieman alaspäin
const VIEW_BASE_RANGE = 4000;  // m, vähimmäisetäisyys kohteeseen

// Kameran etäisyys kasvaa korkeuden mukana, jotta koko korkeusverho pysyy kuvassa.
function viewRange(altMeters) {
  return VIEW_BASE_RANGE + (Number.isFinite(altMeters) ? altMeters : 0) * 2.2;
}

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

// Muuntaa reittipisteet Cartesian3-taulukoksi.
function toCartesians(Cesium, route3d) {
  return route3d
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Number.isFinite(p.alt) ? p.alt : 0)
    );
}

function Globe3D({ lat, lng, alt, route3d = [], theme = 'dark' }) {
  const containerRef = useRef(null);
  const cesiumRef = useRef(null);       // window.Cesium
  const viewerRef = useRef(null);
  const craftEntityRef = useRef(null);
  const positionsRef = useRef([]);      // Cesium.Cartesian3[]
  const craftPosRef = useRef(null);     // Cesium.Cartesian3 | null
  const altRef = useRef(0);             // viimeisin korkeus kameran etäisyyttä varten
  const autoTrackRef = useRef(false);   // seuraako kamera satelliittia
  const didFirstFlyRef = useRef(false);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  // Lentää oletussivunäkymään ja kytkee seurannan päälle lennon päätyttyä.
  // Käytetään sekä ensimmäisellä fixillä että "Palauta näkymä" -napilla.
  const flyToSidePose = useCallback(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    // Vapauta mahdollinen lookAt-transform lennon ajaksi.
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(craftPosRef.current, 1),
      {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(VIEW_HEADING_DEG),
          Cesium.Math.toRadians(VIEW_PITCH_DEG),
          viewRange(altRef.current)
        ),
        duration: 1.5,
        complete: () => {
          autoTrackRef.current = true;
        },
      }
    );
  }, []);

  // Alusta Cesium-viewer kerran.
  useEffect(() => {
    let cancelled = false;

    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;

        const viewer = new Cesium.Viewer(containerRef.current, {
          // Tokeniton: oma CARTO-kuvakerros, ei Ion-maailmankuvaa eikä maastoa.
          baseLayer: cartoLayer(Cesium, theme),
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

        // Sivunäkymän seuranta: joka ruudulla kamera asetetaan kiinteään
        // sivukulmaan satelliitin ympärille (ei pyöri → "drone" seuraa sivusta).
        viewer.scene.preRender.addEventListener(() => {
          if (!autoTrackRef.current || !craftPosRef.current) return;
          viewer.camera.lookAt(
            craftPosRef.current,
            new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(VIEW_HEADING_DEG),
              Cesium.Math.toRadians(VIEW_PITCH_DEG),
              viewRange(altRef.current)
            )
          );
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
    // theme luetaan tarkoituksella vain alustuksessa; teemavaihto hoidetaan
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
    // Ensimmäisellä fixillä lennetään sivunäkymään ja kytketään seuranta.
    if (!didFirstFlyRef.current) {
      didFirstFlyRef.current = true;
      flyToSidePose();
    }
  }, [lat, lng, alt, status, flyToSidePose]);

  // Vaihda karttapohja teeman mukaan.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || status !== 'ready') return;
    viewer.imageryLayers.removeAll(true);
    viewer.imageryLayers.add(cartoLayer(Cesium, theme));
  }, [theme, status]);

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
          onClick={flyToSidePose}
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

- [ ] **Step 2: Append globe CSS to `src/App.css`**

Add at the end of `src/App.css` (after the existing media queries):

```css
/* ── 3D-kartta (Cesium) ───────────────────────────────────────────── */
.globe-wrapper {
  height: 100%;
  width: 100%;
  min-height: 300px;
  position: relative;
  border: 4px solid var(--bg-color); /* sama "inset"-kehys kuin 2D-kartalla */
  border-radius: 2px;
  overflow: hidden;
}

.globe-canvas {
  height: 100%;
  width: 100%;
}

/* Cesiumin oma widget täyttää containerin. */
.globe-canvas .cesium-widget,
.globe-canvas .cesium-widget canvas {
  width: 100%;
  height: 100%;
}

/* Lataus-/virheilmoitus kartan päällä. */
.globe-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1rem;
  background: rgba(4, 6, 15, 0.85);
  color: #f1f5f9;
  font-family: var(--font-display);
  font-size: 0.8rem;
  letter-spacing: 0.15em;
  line-height: 1.6;
  z-index: 500;
}

/* "Palauta näkymä" -nappi 3D-kartan alakulmassa. */
.globe-reset-btn {
  position: absolute;
  bottom: 0.75rem;
  right: 0.75rem;
  z-index: 500;
  background: rgba(4, 6, 15, 0.7);
  backdrop-filter: blur(4px);
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors. (Note the intentional `eslint-disable-next-line react-hooks/exhaustive-deps` on the init effect.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds; `Globe3D` is not yet imported anywhere, so this confirms it parses and bundles cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/components/Globe3D.jsx src/App.css
git commit -m "$(cat <<'EOF'
Add Globe3D component: tokenless Cesium globe with side-trail camera

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **Note:** Visual verification of this component happens in Task 3, once it is wired into the layout. This task's gate is lint + build + code review of the component logic (tokenless config, entity wiring, camera follow/pause/reset, cleanup).

---

### Task 3: Wire the map switch into `App.jsx` (+ toggle CSS)

**Files:**
- Modify: `src/App.jsx` (route helpers ~lines 57-69; imports ~line 9; component state ~lines 104-106; map section ~lines 189-196)
- Modify: `src/App.css` (append map-mode toggle styles)

**Interfaces:**
- Consumes: `Globe3D` (Task 2) and the existing `MapComponent`.
- Produces: a dashboard whose map cell shows `Globe3D` by default and switches to `MapComponent` via an on-map `.map-mode-toggle`.

- [ ] **Step 1: Add the lazy import**

In `src/App.jsx`, immediately after line 9 (`const MapComponent = lazy(() => import('./components/MapComponent'));`), add:

```jsx
const Globe3D = lazy(() => import('./components/Globe3D'));
```

- [ ] **Step 2: Refactor route building to share the downsampler and add `buildRoute3d`**

Replace the existing block (currently lines 57-69):

```jsx
// Reitti on vain visuaalinen: harvennetaan tasavälein mutta pidetään viimeisin
// piste mukana, jotta marker-jälki on ajan tasalla. Raakadata ei muutu.
function buildRoute(history) {
  const pts = [];
  for (const h of history) if (h.fix && h.lat != null && h.lon != null) pts.push([h.lat, h.lon]);
  if (pts.length <= ROUTE_MAX_POINTS) return pts;
  const step = pts.length / ROUTE_MAX_POINTS;
  const out = [];
  for (let i = 0; i < ROUTE_MAX_POINTS; i++) out.push(pts[Math.floor(i * step)]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
```

with:

```jsx
// Reitti on vain visuaalinen: harvennetaan tasavälein mutta pidetään viimeisin
// piste mukana, jotta jälki on ajan tasalla. Raakadata ei muutu.
function downsample(pts) {
  if (pts.length <= ROUTE_MAX_POINTS) return pts;
  const step = pts.length / ROUTE_MAX_POINTS;
  const out = [];
  for (let i = 0; i < ROUTE_MAX_POINTS; i++) out.push(pts[Math.floor(i * step)]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

// 2D-reitti Leaflet-kartalle: [lat, lon] -parit.
function buildRoute(history) {
  const pts = [];
  for (const h of history) if (h.fix && h.lat != null && h.lon != null) pts.push([h.lat, h.lon]);
  return downsample(pts);
}

// 3D-reitti Cesium-kartalle: sama suodatus + harvennus, mutta korkeus mukana.
function buildRoute3d(history) {
  const pts = [];
  for (const h of history) {
    if (h.fix && h.lat != null && h.lon != null) {
      pts.push({ lat: h.lat, lon: h.lon, alt: Number.isFinite(h.alt) ? h.alt : 0 });
    }
  }
  return downsample(pts);
}
```

- [ ] **Step 3: Add `mapMode` state and the `route3d` memo**

In the `App()` function, the current lines are:

```jsx
  const [rangeMs, setRangeMs] = useState(60_000);
  const [theme, toggleTheme] = useTheme();
  const route = useMemo(() => buildRoute(history), [history]);
```

Replace them with:

```jsx
  const [rangeMs, setRangeMs] = useState(60_000);
  const [theme, toggleTheme] = useTheme();
  const [mapMode, setMapMode] = useState('3d'); // '3d' = oletus (näyttävin yleisölle)
  const route = useMemo(() => buildRoute(history), [history]);
  const route3d = useMemo(() => buildRoute3d(history), [history]);
```

- [ ] **Step 4: Replace the map section with the toggle + switch**

Replace the current map section (lines 189-196):

```jsx
          <div className="glass-card map-section">
            <MapComponent
              lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
              lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
              route={route}
              theme={theme}
            />
          </div>
```

with:

```jsx
          <div className="glass-card map-section">
            {/* Karttatyypin valitsin pysyy näkyvissä molemmissa tiloissa, joten
                se renderöidään tässä — ei Globe3D:n sisällä, joka unmountataan
                kun 2D-kartta on valittuna. */}
            <div className="map-mode-toggle">
              <button
                className={`range-btn${mapMode === '3d' ? ' active' : ''}`}
                onClick={() => setMapMode('3d')}
              >
                3D
              </button>
              <button
                className={`range-btn${mapMode === '2d' ? ' active' : ''}`}
                onClick={() => setMapMode('2d')}
              >
                2D
              </button>
            </div>
            <Suspense fallback={<div className="globe-overlay">LADATAAN KARTTAA…</div>}>
              {mapMode === '3d' ? (
                <Globe3D
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  alt={telemetry?.gps_fix ? telemetry.gps_alt : null}
                  route3d={route3d}
                  theme={theme}
                />
              ) : (
                <MapComponent
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  route={route}
                  theme={theme}
                />
              )}
            </Suspense>
          </div>
```

(`Suspense` is already imported on line 1.)

- [ ] **Step 5: Append map-mode toggle CSS to `src/App.css`**

Add at the end of `src/App.css`:

```css
/* Karttatyypin valitsin (2D/3D) kartan yläkulmassa — isot napit ison näytön
   luettavuutta varten. .map-section on position:relative (glass-card). */
.map-mode-toggle {
  position: absolute;
  top: 1.75rem;
  right: 1.75rem;
  z-index: 500;
  display: flex;
  gap: 0.25rem;
  background: rgba(4, 6, 15, 0.7);
  backdrop-filter: blur(4px);
  border-radius: 2px;
}
```

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds; a separate `Globe3D` chunk appears in the build output alongside the existing map/chart chunks.

- [ ] **Step 8: Manual verification (the main visual gate)**

Run: `npm run dev`, open the printed URL. Verify:
1. Dashboard opens on the **3D globe** by default.
2. The flight **trajectory** (amber line) and **altitude curtain** render along the path; the **cyan craft point** sits at the latest fix.
3. The camera frames the balloon **from the side** and **slowly trails** it as new data arrives (no spin).
4. **Dragging / scroll-zoom** takes over the camera (auto-track stops).
5. **"Palauta näkymä"** flies back to the side view and resumes tracking.
6. The **2D / 3D toggle** switches maps; switching back to 3D is fast (CDN cached) and the trajectory reappears.
7. Toggling the **theme** swaps the globe imagery (dark ⇄ light) and the 2D map as before.

> If the camera feel needs adjustment, that is Task 4 — for now just confirm each behaviour occurs.

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx src/App.css
git commit -m "$(cat <<'EOF'
Add 2D/3D map toggle, default to 3D globe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Camera feel-tuning + full verification

**Files:**
- Possibly modify: `src/components/Globe3D.jsx` (only the tuning constants `VIEW_HEADING_DEG`, `VIEW_PITCH_DEG`, `VIEW_BASE_RANGE`, the `viewRange()` multiplier, and the `flyToSidePose` `duration`).

**Interfaces:**
- Consumes: the running app from Task 3.
- Produces: a tuned, fully verified feature.

- [ ] **Step 1: Tune the side-trail camera**

Run `npm run dev`. With live or recent flight data showing, adjust these constants in `src/components/Globe3D.jsx` until the motion matches "slow drone trailing from the side":
- `VIEW_HEADING_DEG` — which side the camera sits on.
- `VIEW_PITCH_DEG` — how much it looks down (more negative = more top-down; keep small for a side profile).
- `VIEW_BASE_RANGE` and the `* 2.2` multiplier in `viewRange()` — how far back the camera sits and how it backs off as altitude grows (so the whole curtain stays framed).
- `duration: 1.5` in `flyToSidePose` — how slow the reset/initial fly is.

Re-check after each change (Vite HMR reloads). Aim for a calm, slow trail with the full altitude curtain visible.

- [ ] **Step 2: Verify the CDN-failure fallback**

In the browser devtools Network tab, block requests to `cesium.com` (right-click the Cesium.js request → Block request domain), then reload.
Expected: the map area shows the Finnish **"3D-KARTAN LATAUS EPÄONNISTUI. KÄYTÄ 2D-KARTTAA."** overlay (not a blank panel), and clicking **2D** shows the working Leaflet map.
Then unblock and reload to confirm 3D recovers.

- [ ] **Step 3: Verify responsive layout**

Resize the browser below 1100px (single-column layout). Expected: the map cell still shows the 3D globe at the `min-height: 400px` size, the toggle stays in the corner, and the 2D/3D switch still works.

- [ ] **Step 4: Final lint + build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit (only if tuning constants changed)**

```bash
git add src/components/Globe3D.jsx
git commit -m "$(cat <<'EOF'
Tune Globe3D side-trail camera

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- §3.1 `loadCesium.js` → Task 1. ✓
- §3.2 `Globe3D.jsx` (props, viewer, entities, refs, theme effect, teardown) → Task 2. ✓
- §3.3 App integration (`mapMode`, `route3d`, switch, toggle) → Task 3. ✓
- §4 data flow (`route3d` filter/downsample; craft from `telemetry`; `heightReference` flip; full-track) → Tasks 2 & 3. ✓
- §5 tokenless config (own `baseLayer`, no Ion/terrain, stripped chrome, smooth controls) → Task 2 init. ✓
- §6 camera (default side pose, slow `preRender` trail, interaction-pause, reset, tuning) → Tasks 2 & 4. ✓
- §7 visuals/theming/switching/layout/loading-error → Tasks 2 (globe CSS, overlays, reset) & 3 (toggle CSS, switch). ✓
- §8 build & verification (lint/build + manual checklist + CDN-failure) → Task 3 Step 8 & Task 4. ✓
- §9 out of scope — respected (no data-layer edits, no Ion, no exaggeration, no time-range map filtering, no push). ✓

**2. Placeholder scan:** No "TBD"/"implement later"/"add error handling" — error handling (CDN failure, no-fix, destroyed-viewer guards) is shown in code. The only deferred values are camera *tuning numbers*, which are real defaults in Task 2 and refined in Task 4 (a live-feel step, not a placeholder). ✓

**3. Type/name consistency:** `loadCesium()` (Task 1) ↔ imported in Task 2. Props `lat/lng/alt/route3d/theme` consistent between `Globe3D` (Task 2) and App's usage (Task 3). `route3d` shape `{lat,lon,alt}` produced by `buildRoute3d` (Task 3) ↔ consumed by `toCartesians` (Task 2). CSS classes `globe-wrapper/globe-canvas/globe-overlay/globe-reset-btn` (Task 2) and `map-mode-toggle` (Task 3) match the JSX. `downsample` shared by `buildRoute`/`buildRoute3d`. ✓
