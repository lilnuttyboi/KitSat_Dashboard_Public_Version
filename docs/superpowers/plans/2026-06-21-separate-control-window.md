# Separate Control Window, Cinematic Lento & Maintenance Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the operator control panel into a separate, live-synced browser window (keeping the audience/TV window control-free), make the "Lento" camera fly-over slow/cinematic and hold a satellite-follow until reset, and polish the maintenance splash.

**Architecture:** A hash route (`#ohjaus`) renders a lightweight control window; a `BroadcastChannel` (+ `localStorage`) module syncs it with the dashboard, which remains the single source of truth. Globe3D's fly-over becomes a two-phase eased move ending in a locked follow. The maintenance splash gets a one-line logo, no gear, a new status string, and a looping typewriter line.

**Tech Stack:** React 19, Vite, Cesium (3D globe, loaded on demand), plain `BroadcastChannel`/`localStorage` (no new deps).

## Global Constraints

- **No test suite.** Verify every task with `npm run lint` (no errors) and `npm run build` (succeeds). Hand manual visual checks to the user.
- **All UI strings and code comments in Finnish.**
- **Data layer untouched** — no changes under `src/hooks/`.
- **Always-dark surfaces** (control window, maintenance splash) hardcode their colors; never bind to theme CSS vars that flip on light theme.
- **Local-only app** (operator computer + TV via HDMI); `BroadcastChannel` + `window.open` are acceptable, no network/SRI concerns.
- Synced settings object shape (used verbatim across tasks): `{ mapMode, basemap, cameraMode, maintenance }` with values `mapMode:'2d'|'3d'`, `basemap:'satellite'|'kartta'`, `cameraMode:'sivu'|'kierto'|'ylha'`, `maintenance:boolean`. Defaults: `{ mapMode:'3d', basemap:'satellite', cameraMode:'sivu', maintenance:false }`.
- Command message names (control → dashboard): `setMapMode`, `setBasemap`, `setCameraMode`, `setMaintenance`, `reset`, `lento`.

---

## Task 1: Cross-window sync module (`controlChannel.js`)

**Files:**
- Create: `src/lib/controlChannel.js`

**Interfaces:**
- Consumes: nothing (pure browser APIs).
- Produces:
  - `createControlChannel() → { post(msg), subscribe(handler) → unsubscribe, close() }`
  - `readPersistedState() → { mapMode, basemap, cameraMode, maintenance }`
  - `writePersistedState(state) → void`

- [ ] **Step 1: Create `src/lib/controlChannel.js`** with EXACTLY this content:

```js
// Ohjausikkunan ja koontinäytön välinen viestikanava (sama kone, sama origin).
// Käärii yhden BroadcastChannelin + localStorage-pysyvyyden. Tämä on ainoa
// paikka joka tuntee viestiformaatin. Ei React-riippuvuutta → testattavissa.

const CHANNEL_NAME = 'kitsat-control';
const STATE_KEY = 'kitsatControlState';

// Oletustila — samat alkuarvot kuin koontinäytöllä (App.jsx).
const DEFAULT_STATE = {
  mapMode: '3d',        // '2d' | '3d'
  basemap: 'satellite', // 'satellite' | 'kartta'
  cameraMode: 'sivu',   // 'sivu' | 'kierto' | 'ylha'
  maintenance: false,
};

// Lue pysyvä tila; palauta oletukset jos puuttuu tai viallinen.
export function readPersistedState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s === 'object') return { ...DEFAULT_STATE, ...s };
  } catch (e) {
    void e; // estetty/viallinen tallennus — käytä oletuksia
  }
  return { ...DEFAULT_STATE };
}

// Säilö tila (lohkeaa hiljaa jos tallennus on estetty, esim. yksityinen tila).
export function writePersistedState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    void e; // ei kriittistä
  }
}

// Luo viestikanava. Palauttaa pienen rajapinnan, joka piilottaa BroadcastChannelin.
export function createControlChannel() {
  const ch = new BroadcastChannel(CHANNEL_NAME);
  return {
    post(msg) {
      ch.postMessage(msg);
    },
    subscribe(handler) {
      const listener = (e) => handler(e.data);
      ch.addEventListener('message', listener);
      return () => ch.removeEventListener('message', listener);
    },
    close() {
      ch.close();
    },
  };
}
```

- [ ] **Step 2: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 3: Build.** Run `npm run build` — expected: success (the module is unused for now; Vite tree-shakes it — that's fine).
- [ ] **Step 4: Commit.**

```bash
git add src/lib/controlChannel.js
git commit -m "Add control-window sync module (BroadcastChannel + localStorage)"
```

---

## Task 2: Control window migration

Moves the control panel out of the dashboard into a separate `#ohjaus` window, wires live sync, and makes the dashboard audience-clean when a control window is connected.

**Files:**
- Modify: `src/components/ControlPanel.jsx` (full rewrite — chrome-less, new props, Näkymä section)
- Create: `src/ControlWindow.jsx`
- Modify: `src/main.jsx` (hash switch)
- Modify: `src/App.jsx` (channel subscribe/broadcast/persist; remove in-page panel/launcher; add "Avaa ohjaus" button; hide on-map 2D/3D toggle when connected)
- Modify: `src/App.css` (replace floating-panel/launcher styles with control-window-page + open-control-btn styles)

**Interfaces:**
- Consumes (from Task 1): `createControlChannel`, `readPersistedState`, `writePersistedState`.
- Produces: `ControlWindow` default export; `ControlPanel` new prop signature `{ mapMode, onMapModeChange, basemap, onBasemapChange, cameraMode, onCameraModeChange, onReset, onFlyover, maintenance, onMaintenanceToggle }`.

- [ ] **Step 1: Rewrite `src/components/ControlPanel.jsx`** with EXACTLY this content (replaces the whole file — drops the drag/position/titlebar/close chrome, adds the Näkymä 2D/3D section, no React-hook imports needed):

```jsx
// Ohjauspaneeli: napit näkymälle (2D/3D), pohjakartalle, kameralle ja
// huoltotilalle. Renderöidään erillisen ohjausikkunan sisään (täyttää ikkunan)
// — ei enää kelluva/raahattava. Tila ja takaisinkutsut tulevat isännältä.
export default function ControlPanel({
  mapMode,
  onMapModeChange,
  basemap,
  onBasemapChange,
  cameraMode,
  onCameraModeChange,
  onReset,
  onFlyover,
  maintenance,
  onMaintenanceToggle,
}) {
  const is2d = mapMode === '2d';

  return (
    <div className="control-panel">
      <div className="control-section">
        <span className="control-label">Näkymä</span>
        <div className="control-row">
          <button
            className={`range-btn${mapMode === '3d' ? ' active' : ''}`}
            onClick={() => onMapModeChange('3d')}
          >
            3D
          </button>
          <button
            className={`range-btn${mapMode === '2d' ? ' active' : ''}`}
            onClick={() => onMapModeChange('2d')}
          >
            2D
          </button>
        </div>
      </div>

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
  );
}
```

- [ ] **Step 2: Create `src/ControlWindow.jsx`** with EXACTLY this content:

```jsx
import { useEffect, useRef, useState } from 'react';
import ControlPanel from './components/ControlPanel';
import { createControlChannel, readPersistedState } from './lib/controlChannel';
import './App.css';

// Erillinen ohjausikkuna (#ohjaus). Kevyt: ei karttoja eikä telemetriaa, vain
// napit ja viestikanava. Lähettää komennot koontinäytölle ja heijastaa sen
// tilan (nappien korostukset) takaisin tulevista tila-viesteistä.
export default function ControlWindow() {
  const [state, setState] = useState(readPersistedState);
  const channelRef = useRef(null);

  useEffect(() => {
    const channel = createControlChannel();
    channelRef.current = channel;

    const unsubscribe = channel.subscribe((msg) => {
      if (msg?.type === 'state' && msg.state) setState(msg.state);
    });

    // Ilmoittaudu: koontinäyttö vastaa tilalla ja piilottaa omat säätimensä.
    channel.post({ type: 'hello' });
    const sayBye = () => channel.post({ type: 'bye' });
    window.addEventListener('beforeunload', sayBye);

    return () => {
      sayBye();
      window.removeEventListener('beforeunload', sayBye);
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const command = (name, value) =>
    channelRef.current?.post({ type: 'command', name, value });

  return (
    <div className="control-window-page">
      <header className="control-window-header">OHJAUS</header>
      <ControlPanel
        mapMode={state.mapMode}
        onMapModeChange={(v) => command('setMapMode', v)}
        basemap={state.basemap}
        onBasemapChange={(v) => command('setBasemap', v)}
        cameraMode={state.cameraMode}
        onCameraModeChange={(v) => command('setCameraMode', v)}
        onReset={() => command('reset')}
        onFlyover={() => command('lento')}
        maintenance={state.maintenance}
        onMaintenanceToggle={() => command('setMaintenance', !state.maintenance)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/main.jsx`** with EXACTLY this content (adds the hash switch):

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ControlWindow from './ControlWindow.jsx'

// #ohjaus → erillinen kevyt ohjausikkuna; muuten varsinainen koontinäyttö.
const isControl = window.location.hash === '#ohjaus';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isControl ? <ControlWindow /> : <App />}
  </StrictMode>,
)
```

- [ ] **Step 4: Update `src/App.jsx` imports.** Find:

```jsx
import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
```
Replace with:
```jsx
import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
```

Then find:
```jsx
import ControlPanel from './components/ControlPanel';
import MaintenanceOverlay from './components/MaintenanceOverlay';
import './App.css';
```
Replace with:
```jsx
import MaintenanceOverlay from './components/MaintenanceOverlay';
import { createControlChannel, readPersistedState, writePersistedState } from './lib/controlChannel';
import './App.css';
```

- [ ] **Step 5: Seed state from persistence + add the sync effects in `src/App.jsx`.** Find:

```jsx
  const [mapMode, setMapMode] = useState('3d'); // '3d' = oletus (näyttävin yleisölle)
  const [basemap, setBasemap] = useState('satellite');   // 'satellite' | 'kartta'
  const [cameraMode, setCameraMode] = useState('sivu');  // 'sivu' | 'kierto' | 'ylha'
  const [resetNonce, setResetNonce] = useState(0);       // bump -> Globe3D kehystää uudelleen
  const [flyoverNonce, setFlyoverNonce] = useState(0);   // bump -> Globe3D lentää reitin yli
  const [panelOpen, setPanelOpen] = useState(true);      // ohjauspaneelin näkyvyys
  const [maintenance, setMaintenance] = useState(false); // huoltotila: peittää näkymän
```
Replace with:
```jsx
  // Säätötila siemennetään pysyvyydestä, jotta koontinäytön lataus palauttaa
  // viimeisimmät valinnat (ja täsmää ohjausikkunan kanssa).
  const [mapMode, setMapMode] = useState(() => readPersistedState().mapMode);       // '2d' | '3d'
  const [basemap, setBasemap] = useState(() => readPersistedState().basemap);       // 'satellite' | 'kartta'
  const [cameraMode, setCameraMode] = useState(() => readPersistedState().cameraMode); // 'sivu' | 'kierto' | 'ylha'
  const [resetNonce, setResetNonce] = useState(0);       // bump -> Globe3D kehystää uudelleen
  const [flyoverNonce, setFlyoverNonce] = useState(0);   // bump -> Globe3D lentää reitin yli
  const [maintenance, setMaintenance] = useState(() => readPersistedState().maintenance); // huoltotila
  const [controlConnected, setControlConnected] = useState(false); // onko ohjausikkuna kytketty

  // ── Ohjauskanava: erillinen #ohjaus-ikkuna ohjaa tätä koontinäyttöä ──────
  // Koontinäyttö on tilan ainoa lähde: se soveltaa komennot ja lähettää
  // tuoreimman tilan takaisin (nappien korostuksia varten).
  const channelRef = useRef(null);
  const stateRef = useRef(null);
  if (stateRef.current === null) {
    stateRef.current = { mapMode, basemap, cameraMode, maintenance };
  }

  useEffect(() => {
    const channel = createControlChannel();
    channelRef.current = channel;

    const unsubscribe = channel.subscribe((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') {
        setControlConnected(true);
        channel.post({ type: 'state', state: stateRef.current });
        return;
      }
      if (msg.type === 'bye') {
        setControlConnected(false);
        return;
      }
      if (msg.type === 'command') {
        switch (msg.name) {
          case 'setMapMode': setMapMode(msg.value); break;
          case 'setBasemap': setBasemap(msg.value); break;
          case 'setCameraMode': setCameraMode(msg.value); break;
          case 'setMaintenance': setMaintenance(Boolean(msg.value)); break;
          case 'reset': setResetNonce((n) => n + 1); break;
          case 'lento': setFlyoverNonce((n) => n + 1); break;
          default: break;
        }
      }
    });

    return () => {
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // Lähetä tuorein tila ohjausikkunalle ja säilö se. Tämä efekti ajetaan myös
  // mountissa → ennen koontinäyttöä avattu ohjausikkuna saa tilan heti.
  useEffect(() => {
    const snapshot = { mapMode, basemap, cameraMode, maintenance };
    stateRef.current = snapshot;
    writePersistedState(snapshot);
    channelRef.current?.post({ type: 'state', state: snapshot });
  }, [mapMode, basemap, cameraMode, maintenance]);
```

- [ ] **Step 6: Hide the on-map 2D/3D toggle when a control window is connected.** In `src/App.jsx` find:

```jsx
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
```
Replace with:
```jsx
            {!controlConnected && (
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
            )}
```

- [ ] **Step 7: Replace the in-page panel/launcher with the "Avaa ohjaus" button.** In `src/App.jsx` find:

```jsx
    {panelOpen ? (
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
Replace with:
```jsx
    {!controlConnected && (
      <button
        className="open-control-btn"
        onClick={() =>
          window.open(
            `${window.location.origin}${window.location.pathname}#ohjaus`,
            'kitsat-ohjaus',
            'width=420,height=720'
          )
        }
        title="Avaa ohjaus erilliseen ikkunaan"
      >
        Avaa ohjaus
      </button>
    )}
    {maintenance && <MaintenanceOverlay />}
    </>
```

- [ ] **Step 8: Replace the floating-panel + launcher CSS in `src/App.css`.** Find the entire block from the `Ohjauspaneeli` comment through the `.control-launcher:hover` rule:

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
Replace with:
```css
/* ── Erillinen ohjausikkuna (#ohjaus) ──────────────────────────────────
   Täyttää oman selainikkunansa. Aina tumma pohja (kuten yläpalkki); värit
   kovakoodataan eikä sidota teemamuuttujiin (jotka vaalealla muuttuisivat). */
.control-window-page {
  min-height: 100vh;
  background: #0b0f1a;
  color: #f1f5f9;
  display: flex;
  flex-direction: column;
}
.control-window-header {
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.control-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}
.control-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.control-section.disabled {
  opacity: 0.5;
}
.control-label {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #94a3b8;
  text-transform: uppercase;
}
.control-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.control-row .range-btn {
  flex: 1;
}
.control-wide {
  width: 100%;
}
.control-hint {
  font-family: var(--font-sans);
  font-size: 0.7rem;
  line-height: 1.4;
  color: #94a3b8;
}

/* Napit tummalla pohjalla — kirkkaat värit molemmissa teemoissa. */
.control-window-page .range-btn {
  color: #94a3b8;
  border-color: rgba(255, 255, 255, 0.18);
}
.control-window-page .range-btn:hover {
  color: #fff;
  border-color: #fff;
}
.control-window-page .range-btn.active {
  color: #fbbf24;
  border-color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
}
.control-window-page .range-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.control-window-page .range-btn:disabled:hover {
  color: #94a3b8;
  border-color: rgba(255, 255, 255, 0.18);
}

/* "Avaa ohjaus" -nappi koontinäytöllä; piilotetaan kun ohjausikkuna on auki. */
.open-control-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2000;
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.5rem 0.75rem;
  background: rgba(11, 15, 26, 0.92);
  backdrop-filter: var(--glass);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: #f1f5f9;
  cursor: pointer;
}
.open-control-btn:hover {
  border-color: #fff;
}
```

- [ ] **Step 9: Lint.** Run `npm run lint` — expected: no errors (no unused `panelOpen`/`ControlPanel`; the new effect's deps are the four primitives).
- [ ] **Step 10: Build.** Run `npm run build` — expected: success.
- [ ] **Step 11: Manual check (hand to user).** Open the app; a small "Avaa ohjaus" button shows bottom-right. Click it → a second window opens at `#ohjaus` showing OHJAUS + the control panel. On the dashboard, the "Avaa ohjaus" button AND the on-map 2D/3D toggle disappear (audience-clean). From the control window, toggle 2D/3D, basemap, camera modes, and Huoltotila — each reflects live on the dashboard and the control buttons highlight the active state. Close the control window → the dashboard's button + toggle reappear. Reload each window independently → settings persist and roles persist.
- [ ] **Step 12: Commit.**

```bash
git add src/components/ControlPanel.jsx src/ControlWindow.jsx src/main.jsx src/App.jsx src/App.css
git commit -m "Move control panel into a separate live-synced window"
```

---

## Task 3: Cinematic two-phase Lento (Globe3D)

Replaces the abrupt 4s fly-over with a slow eased route sweep, an eased settle onto the satellite, and a locked follow that holds until reset.

**Files:**
- Modify: `src/components/Globe3D.jsx`

**Interfaces:**
- Consumes: existing `flyoverNonce`, `resetNonce`, `cameraMode` props (unchanged signatures).
- Produces: no new props. Internal: a `lentoFollowRef` follow state; the `flyoverNonce` effect now plays a two-phase cinematic move ending in the locked follow.

- [ ] **Step 1: Replace the fly-over duration constant with cinematic constants.** In `src/components/Globe3D.jsx` find:

```jsx
const FLYOVER_DURATION = 4.0;  // Lento-animaation kesto sekunteina
```
Replace with:
```jsx
// "Lento" on kaksivaiheinen, hidas ja elokuvamainen liike:
const LENTO_SWEEP_SEC = 12.0;          // vaihe 1: hidas pyyhkäisy koko reitin yli
const LENTO_SETTLE_SEC = 5.0;          // vaihe 2: pehmeä laskeutuminen seurantaan
const LENTO_FOLLOW_HEADING_DEG = 35;   // loppuseurannan sivukulma
const LENTO_FOLLOW_PITCH_DEG = -18;    // loiva yläviisto
const LENTO_FOLLOW_RANGE_FACTOR = 3.2; // vetäytyy kauemmas → elokuvamaisempi
```

- [ ] **Step 2: Add the follow-state ref.** Find:

```jsx
  const orbitStartRef = useRef(null);       // Cesium.JulianDate: kierron alkuhetki
```
Replace with:
```jsx
  const orbitStartRef = useRef(null);       // Cesium.JulianDate: kierron alkuhetki
  const lentoFollowRef = useRef(false);     // "lento"-seuranta lukittu kunnes reset
```

- [ ] **Step 3: Clear the follow when re-framing to a selected mode (reset path).** Find:

```jsx
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    if (cameraModeRef.current === 'kierto') {
      orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
    }
```
Replace with:
```jsx
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    lentoFollowRef.current = false; // reset/uudelleenkehystys lopettaa lento-seurannan
    if (cameraModeRef.current === 'kierto') {
      orbitStartRef.current = Cesium.JulianDate.clone(viewer.clock.currentTime);
    }
```

- [ ] **Step 4: Render the locked follow in the preRender tracking loop.** Find:

```jsx
          const mode = cameraModeRef.current;
          const a = altRef.current;
          if (mode === 'kierto') {
```
Replace with:
```jsx
          const mode = cameraModeRef.current;
          const a = altRef.current;
          if (lentoFollowRef.current) {
            // Lukittu lento-seuranta: vetäytynyt elokuvamainen kulma satelliittiin.
            trackHpr.heading = Cesium.Math.toRadians(LENTO_FOLLOW_HEADING_DEG);
            trackHpr.pitch = Cesium.Math.toRadians(LENTO_FOLLOW_PITCH_DEG);
            trackHpr.range = VIEW_BASE_RANGE + (Number.isFinite(a) ? a : 0) * LENTO_FOLLOW_RANGE_FACTOR;
          } else if (mode === 'kierto') {
```

- [ ] **Step 5: Clear the follow when the camera mode changes.** Find:

```jsx
    cameraModeRef.current = cameraMode;
```
Replace with:
```jsx
    cameraModeRef.current = cameraMode;
    lentoFollowRef.current = false; // tilan vaihto lopettaa lento-seurannan
```

- [ ] **Step 6: Rewrite the fly-over effect into the two-phase cinematic move.** Find:

```jsx
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
```
Replace with:
```jsx
  // "Lento": hidas, pehmennetty pyyhkäisy koko reitin yli → laskeutuu satelliitin
  // elokuvamaiseen seurantaan ja PYSYY siinä kunnes Palauta näkymä painetaan.
  useEffect(() => {
    if (flyoverNonce === 0) return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed() || !craftPosRef.current) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    autoTrackRef.current = false;
    lentoFollowRef.current = false;
    const positions = positionsRef.current;
    const routeSphere =
      positions.length >= 2
        ? Cesium.BoundingSphere.fromPoints(positions)
        : new Cesium.BoundingSphere(craftPosRef.current, VIEW_BASE_RANGE);

    // Vaihe 1: hidas, pehmennetty pyyhkäisy koko reitin yli.
    viewer.camera.flyToBoundingSphere(routeSphere, {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(VIEW_HEADING_DEG),
        Cesium.Math.toRadians(-30),
        routeSphere.radius * 2.5
      ),
      duration: LENTO_SWEEP_SEC,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
      complete: () => {
        if (viewer.isDestroyed() || !craftPosRef.current) return;
        // Vaihe 2: laskeudu pehmeästi satelliitin elokuvamaiseen seurantaan.
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(craftPosRef.current, 1), {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(LENTO_FOLLOW_HEADING_DEG),
            Cesium.Math.toRadians(LENTO_FOLLOW_PITCH_DEG),
            VIEW_BASE_RANGE + (Number.isFinite(altRef.current) ? altRef.current : 0) * LENTO_FOLLOW_RANGE_FACTOR
          ),
          duration: LENTO_SETTLE_SEC,
          easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => {
            if (viewer.isDestroyed()) return;
            lentoFollowRef.current = true; // lukitse seuranta kunnes reset
            autoTrackRef.current = true;
          },
        });
      },
    });
  }, [flyoverNonce]);
```

- [ ] **Step 7: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 8: Build.** Run `npm run build` — expected: success.
- [ ] **Step 9: Manual check (hand to user).** In 3D, press **Lento** (from the control window). The camera slowly, smoothly sweeps to frame the whole route (~12 s, eased — not the old snappy 4 s), then eases down into a pulled-back follow of the satellite and keeps tracking it indefinitely. It does NOT auto-return. Press **Palauta näkymä** → it returns to the default Sivu view. Switching camera mode during the follow also exits it. No console errors.
- [ ] **Step 10: Commit.**

```bash
git add src/components/Globe3D.jsx
git commit -m "Make Lento a slow two-phase cinematic move that holds follow until reset"
```

---

## Task 4: Maintenance splash polish

One-line logo, remove the gear, new status string, and a looping typewriter funny line (reduced-motion shows static text).

**Files:**
- Modify: `src/components/MaintenanceOverlay.jsx` (rewrite)
- Modify: `src/App.css` (logo nowrap; remove gear + keyframes; add caret styles)

**Interfaces:**
- Consumes: nothing new (rendered by `App.jsx` when `maintenance` is true — unchanged).
- Produces: same default export, no props.

- [ ] **Step 1: Rewrite `src/components/MaintenanceOverlay.jsx`** with EXACTLY this content:

```jsx
import { useEffect, useRef, useState } from 'react';

// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Tekstit on eristetty vakioiksi, jotta niitä on helppo muokata.
const LOGO = 'PORI SPACE LAB';
const STATUS = 'Huoltotoimet käynnissä';
const FUNNY = 'Ruuvataan vielä pari pulttia kiinni palaamme pian...';

// Kirjoituskoneanimaation ajat (ms).
const TYPE_MS = 55;   // merkin kirjoitusväli
const ERASE_MS = 30;  // merkin pyyhkimisväli
const HOLD_MS = 2200; // tauko kun teksti on valmis
const GAP_MS = 600;   // tauko ennen uutta kirjoituskierrosta

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    void e;
    return false;
  }
}

// Looppaava kirjoituskone: kirjoittaa → pitää tauon → pyyhkii → toistaa.
// Liikettä vältettäessä näytetään koko teksti staattisena.
function useTypewriter(text) {
  const [shown, setShown] = useState(text);
  const timerRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text);
      return undefined;
    }
    let i = 0;
    let erasing = false;
    setShown('');
    const tick = () => {
      if (!erasing) {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          erasing = true;
          timerRef.current = setTimeout(tick, HOLD_MS);
          return;
        }
        timerRef.current = setTimeout(tick, TYPE_MS);
      } else {
        i -= 1;
        setShown(text.slice(0, i));
        if (i <= 0) {
          erasing = false;
          timerRef.current = setTimeout(tick, GAP_MS);
          return;
        }
        timerRef.current = setTimeout(tick, ERASE_MS);
      }
    };
    timerRef.current = setTimeout(tick, TYPE_MS);
    return () => clearTimeout(timerRef.current);
  }, [text]);

  return shown;
}

export default function MaintenanceOverlay() {
  const typed = useTypewriter(FUNNY);
  const animated = !prefersReducedMotion();

  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <h1 className="maintenance-logo">{LOGO}</h1>
        <p className="maintenance-status">{STATUS}</p>
        {/* Animoitu rivi piilotetaan ruudunlukijalta (näppäinkohina); staattinen
            (reduced-motion) versio luetaan normaalisti. */}
        <p className="maintenance-funny" aria-hidden={animated ? 'true' : undefined}>
          {typed}
          {animated && <span className="maintenance-caret" aria-hidden="true">|</span>}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Force the logo onto one line.** In `src/App.css` find:

```css
.maintenance-logo {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 7vw, 5rem);
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 0.95;
  color: #fff;
}
```
Replace with:
```css
.maintenance-logo {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 7vw, 5rem);
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 0.95;
  color: #fff;
  white-space: nowrap; /* "PORI SPACE LAB" pysyy yhdellä rivillä */
}
```

- [ ] **Step 3: Remove the gear element's CSS and its keyframes.** In `src/App.css` find and DELETE this entire block:

```css
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
```

- [ ] **Step 4: Add caret styles and repoint the reduced-motion rule.** In `src/App.css` find:

```css
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
Replace with:
```css
.maintenance-funny {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(0.85rem, 1.6vw, 1.1rem);
  color: #94a3b8;
  min-height: 1.4em; /* varaa tila ettei asettelu hyppää kun teksti tyhjenee */
}
.maintenance-caret {
  margin-left: 2px;
  color: #fbbf24;
  animation: maint-caret-blink 1s step-end infinite;
}
@keyframes maint-caret-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .maintenance-caret {
    animation: none;
  }
}
```

- [ ] **Step 5: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 6: Build.** Run `npm run build` — expected: success.
- [ ] **Step 7: Manual check (hand to user).** Turn on Huoltotila. The splash shows `PORI SPACE LAB` on a single line (no spinning gear), `Huoltotoimet käynnissä` below it, and the funny line types out `Ruuvataan vielä pari pulttia kiinni palaamme pian...` (no dash) with a blinking caret, holds, backspaces, and loops — without the layout jumping. Confirm it reads correctly in both light and dark UI themes (always dark).
- [ ] **Step 8: Commit.**

```bash
git add src/components/MaintenanceOverlay.jsx src/App.css
git commit -m "Polish maintenance splash: one-line logo, no gear, looping typewriter"
```

---

## Notes for the executor

- Keep all comments/strings Finnish; keep the always-dark surfaces hardcoded.
- Tasks 3 and 4 are independent of 1–2 and of each other; Task 2 depends on Task 1. Execute in order 1 → 2 → 3 → 4.
- `BroadcastChannel` and `window.matchMedia` are standard in the target desktop browsers; no polyfill needed for this local app.
