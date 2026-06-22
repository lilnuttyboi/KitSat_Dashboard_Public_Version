# Branded Splash & Control-Panel Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the maintenance splash a pure-branding logo screen, and move the night-mode toggle and the time-range buttons out of the dashboard header into the separate `#ohjaus` control window only.

**Architecture:** The splash becomes a centered, wrap-friendly logo row (one logo now, scalable to several) plus an optional tagline slot. Theme and range join the existing `BroadcastChannel` synced-state object (`{ mapMode, basemap, cameraMode, maintenance }` → `+ theme, range`) with two new commands (`setTheme`, `setRange`); the header controls are deleted, leaving the dashboard audience-clean and driven solely by the control window.

**Tech Stack:** React 19, Vite, plain `BroadcastChannel`/`localStorage` (no new deps).

## Global Constraints

- **No test suite.** Verify every task with `npm run lint` (no errors) and `npm run build` (succeeds). Hand manual visual checks to the user.
- **All UI strings and code comments in Finnish.**
- **Data layer untouched** — no changes under `src/hooks/`.
- **Always-dark surfaces** (control window, maintenance splash) hardcode their colors; never bind to theme CSS vars.
- Synced state object shape (used verbatim): `{ mapMode, basemap, cameraMode, maintenance, theme, range }` with `mapMode:'2d'|'3d'`, `basemap:'satellite'|'kartta'`, `cameraMode:'sivu'|'kierto'|'ylha'`, `maintenance:boolean`, `theme:'dark'|'light'`, `range:number|null` (ms; `null`=MAX). Defaults: `{ mapMode:'3d', basemap:'satellite', cameraMode:'sivu', maintenance:false, theme:'dark', range:60000 }`.
- Command names (control → dashboard): `setMapMode`, `setBasemap`, `setCameraMode`, `setMaintenance`, `setTheme`, `setRange`, `reset`, `lento`.
- **Control-panel-only trade-off:** a dashboard opened without a control window cannot change theme or range (stays OS-default theme + 1m range). Intended.

**Task order:** 1 (splash) is independent. 2 → 3 → 4 → 5 build the control migration; do them in order.

---

## Task 1: Branded maintenance splash

Replaces the wordmark + status + typewriter with a logo row + optional tagline.

**Files:**
- Create: `public/maintenance-logo.svg` (placeholder; user replaces with the real logo)
- Modify: `src/components/MaintenanceOverlay.jsx` (full rewrite)
- Modify: `src/App.css` (splash styles)

**Interfaces:**
- Consumes: nothing new (rendered by `App.jsx` when `maintenance` is true — unchanged).
- Produces: same default export, no props.

- [ ] **Step 1: Create `public/maintenance-logo.svg`** with EXACTLY this content (a neutral light placeholder that reads on the dark splash — the user overwrites this file with their own logo):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" fill="none">
  <!-- Väliaikainen paikkamerkkilogo — korvaa tämä tiedosto omalla logollasi. -->
  <circle cx="120" cy="120" r="34" fill="#f1f5f9"/>
  <ellipse cx="120" cy="120" rx="92" ry="40" stroke="#94a3b8" stroke-width="6" transform="rotate(-25 120 120)"/>
  <circle cx="196" cy="92" r="7" fill="#fbbf24"/>
</svg>
```

- [ ] **Step 2: Rewrite `src/components/MaintenanceOverlay.jsx`** with EXACTLY this content (drops the typewriter hook and all its imports):

```jsx
// Huoltoruutu: peittää koko julkisen näkymän kun huoltotila on päällä.
// Pelkkä brändiruutu: keskitetty logorivi + valinnainen iskulause.

// Logot renderöidään rivinä (nyt yksi). Lisää myöhemmin uusia { src, alt }
// -alkioita → rivi kasvaa ja kietoutuu ilman muutoksia merkkaukseen/tyyleihin.
// Tiedosto on public/-kansiossa, joten viitataan BASE_URL:n kautta.
const LOGOS = [
  { src: `${import.meta.env.BASE_URL}maintenance-logo.svg`, alt: 'Pori Space Lab' },
];

// Valinnainen iskulause — tyhjä = ei näytetä. Täytä myöhemmin, näkyy automaattisesti.
const TAGLINE = '';

export default function MaintenanceOverlay() {
  return (
    <div className="maintenance-overlay" role="status" aria-live="polite">
      <div className="maintenance-inner">
        <div className="maintenance-logos">
          {LOGOS.map((logo) => (
            <img key={logo.src} className="maintenance-logo-img" src={logo.src} alt={logo.alt} />
          ))}
        </div>
        {TAGLINE && <p className="maintenance-tagline">{TAGLINE}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Swap the splash text styles for logo/tagline styles in `src/App.css`.** Find this entire block (the `.maintenance-logo` rule through the reduced-motion `.maintenance-caret` block):

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
Replace with:
```css
/* Logorivi: keskitetty, kietoutuu usealle logolle (nyt yksi). */
.maintenance-logos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: clamp(1.5rem, 4vw, 3rem);
}
.maintenance-logo-img {
  max-height: clamp(4rem, 16vw, 9rem);
  max-width: 80vw;
  width: auto;
  height: auto;
  object-fit: contain;
}
/* Valinnainen iskulause (näkyy vain kun TAGLINE on asetettu). */
.maintenance-tagline {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(0.9rem, 2vw, 1.4rem);
  letter-spacing: 0.15em;
  color: #94a3b8;
}
```

- [ ] **Step 4: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 5: Build.** Run `npm run build` — expected: success.
- [ ] **Step 6: Manual check (hand to user).** Turn on Huoltotila. The splash shows the centered placeholder logo on the dark space background — no wordmark text, no status line, no typewriter line. Drop the real logo into `public/maintenance-logo.svg` (light/transparent art) and it appears in its place. Reads correctly in both light and dark UI themes (splash is always dark).
- [ ] **Step 7: Commit.**

```bash
git add public/maintenance-logo.svg src/components/MaintenanceOverlay.jsx src/App.css
git commit -m "Make maintenance splash a branded logo screen"
```

---

## Task 2: Add theme + range to synced-state defaults

**Files:**
- Modify: `src/lib/controlChannel.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_STATE` now includes `theme:'dark'` and `range:60000`; `readPersistedState()` returns these keys (merged over any persisted value).

- [ ] **Step 1: Extend `DEFAULT_STATE` in `src/lib/controlChannel.js`.** Find:

```js
const DEFAULT_STATE = {
  mapMode: '3d',        // '2d' | '3d'
  basemap: 'satellite', // 'satellite' | 'kartta'
  cameraMode: 'sivu',   // 'sivu' | 'kierto' | 'ylha'
  maintenance: false,
};
```
Replace with:
```js
const DEFAULT_STATE = {
  mapMode: '3d',        // '2d' | '3d'
  basemap: 'satellite', // 'satellite' | 'kartta'
  cameraMode: 'sivu',   // 'sivu' | 'kierto' | 'ylha'
  maintenance: false,
  theme: 'dark',        // 'dark' | 'light'
  range: 60000,         // kaavioiden aikaväli ms; null = MAX
};
```

- [ ] **Step 2: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 3: Build.** Run `npm run build` — expected: success.
- [ ] **Step 4: Commit.**

```bash
git add src/lib/controlChannel.js
git commit -m "Add theme + range to synced control state defaults"
```

---

## Task 3: Dashboard wiring — theme/range over the channel, header controls removed

Adds a direct theme setter, seeds range from persistence, handles the two new commands, broadcasts theme+range, and deletes the header's range buttons + theme toggle (and the now-dead `Icon`/`ICONS`/`RANGES`).

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css` (delete dead `.header-range` + `.theme-btn` rules)

**Interfaces:**
- Consumes (from Task 2): `readPersistedState().range`, `readPersistedState().theme`.
- Produces: command handlers for `setTheme` (`'dark'|'light'`) and `setRange` (`number|null`); broadcast snapshot `{ mapMode, basemap, cameraMode, maintenance, theme, range }`. `useTheme()` now returns `[theme, toggleTheme, setThemeChoice]` where `setThemeChoice(value)` sets+persists an explicit theme.

- [ ] **Step 1: Add a direct theme setter to `useTheme`.** In `src/App.jsx` find:

```jsx
  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      return next;
    });
  };

  return [theme, toggleTheme];
```
Replace with:
```jsx
  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      return next;
    });
  };

  // Aseta teema suoraan annettuun arvoon (ohjauspaneelin Teema-napit).
  const setThemeChoice = (value) => {
    const next = value === 'light' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  return [theme, toggleTheme, setThemeChoice];
```

- [ ] **Step 2: Delete the now-unused `RANGES` constant.** In `src/App.jsx` find:

```jsx
const RANGES = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: 'MAX', ms: null },
];

const ROUTE_MAX_POINTS = 2000;
```
Replace with:
```jsx
const ROUTE_MAX_POINTS = 2000;
```

- [ ] **Step 3: Delete the now-unused `Icon` + `ICONS` (only the theme button used them).** In `src/App.jsx` find:

```jsx
}

const Icon = ({ children }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ICONS = {
  sun: <Icon><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></Icon>,
  moon: <Icon><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></Icon>,
};

// Mittarikortti: otsikko ikonilla, nykyarvo, valinnainen min/max-rivi ja kaavio.
```
Replace with:
```jsx
}

// Mittarikortti: otsikko ikonilla, nykyarvo, valinnainen min/max-rivi ja kaavio.
```

- [ ] **Step 4: Seed `rangeMs` from persistence.** In `src/App.jsx` find:

```jsx
  const [rangeMs, setRangeMs] = useState(60_000);
  const [theme, toggleTheme] = useTheme();
```
Replace with:
```jsx
  const [rangeMs, setRangeMs] = useState(() => readPersistedState().range); // ms tai null (MAX)
  const [theme, , setThemeChoice] = useTheme(); // setThemeChoice: ohjauspaneelin Teema-komento
```

- [ ] **Step 5: Include theme+range in the initial `stateRef` snapshot.** In `src/App.jsx` find:

```jsx
  if (stateRef.current === null) {
    stateRef.current = { mapMode, basemap, cameraMode, maintenance };
  }
```
Replace with:
```jsx
  if (stateRef.current === null) {
    stateRef.current = { mapMode, basemap, cameraMode, maintenance, theme, range: rangeMs };
  }
```

- [ ] **Step 6: Handle the two new commands.** In `src/App.jsx` find:

```jsx
          case 'setMaintenance': setMaintenance(Boolean(msg.value)); break;
          case 'reset': setResetNonce((n) => n + 1); break;
          case 'lento': setFlyoverNonce((n) => n + 1); break;
```
Replace with:
```jsx
          case 'setMaintenance': setMaintenance(Boolean(msg.value)); break;
          case 'setTheme': setThemeChoice(msg.value === 'light' ? 'light' : 'dark'); break;
          case 'setRange': setRangeMs(msg.value); break;
          case 'reset': setResetNonce((n) => n + 1); break;
          case 'lento': setFlyoverNonce((n) => n + 1); break;
```

- [ ] **Step 7: Broadcast theme+range in the snapshot effect.** In `src/App.jsx` find:

```jsx
  useEffect(() => {
    const snapshot = { mapMode, basemap, cameraMode, maintenance };
    stateRef.current = snapshot;
    writePersistedState(snapshot);
    channelRef.current?.post({ type: 'state', state: snapshot });
  }, [mapMode, basemap, cameraMode, maintenance]);
```
Replace with:
```jsx
  useEffect(() => {
    const snapshot = { mapMode, basemap, cameraMode, maintenance, theme, range: rangeMs };
    stateRef.current = snapshot;
    writePersistedState(snapshot);
    channelRef.current?.post({ type: 'state', state: snapshot });
  }, [mapMode, basemap, cameraMode, maintenance, theme, rangeMs]);
```

- [ ] **Step 8: Remove the header range buttons.** In `src/App.jsx` find and DELETE this entire block:

```jsx
          <div className="header-range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                className={`range-btn${rangeMs === r.ms ? ' active' : ''}`}
                onClick={() => setRangeMs(r.ms)}
              >
                {r.label}
              </button>
            ))}
          </div>
```

- [ ] **Step 9: Remove the header theme toggle button.** In `src/App.jsx` find:

```jsx
        <div className="header-right">
          <button className="range-btn theme-btn" onClick={toggleTheme} aria-label="Vaihda teema" title="Vaihda teema">
            {theme === 'dark' ? ICONS.sun : ICONS.moon}
          </button>
          <div className={`status-indicator ${status}`}>
```
Replace with:
```jsx
        <div className="header-right">
          <div className={`status-indicator ${status}`}>
```

- [ ] **Step 10: Delete the dead `.header-range` CSS rule.** In `src/App.css` find and DELETE this entire block:

```css
.header-range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}
```

- [ ] **Step 11: Delete the dead `.theme-btn` CSS rule.** In `src/App.css` find and DELETE this entire block:

```css
.theme-btn {
  display: flex;
  align-items: center;
}
```

- [ ] **Step 12: Lint.** Run `npm run lint` — expected: no errors (no unused `RANGES`/`Icon`/`ICONS`/`toggleTheme`; `theme`, `rangeMs`, `setRangeMs`, `setThemeChoice` are all still referenced).
- [ ] **Step 13: Build.** Run `npm run build` — expected: success.
- [ ] **Step 14: Commit.**

```bash
git add src/App.jsx src/App.css
git commit -m "Move theme + range off the dashboard header onto the control channel"
```

---

## Task 4: Control panel — Teema + Aikaväli sections

Adds the theme and range controls to the panel and owns the `RANGES` list.

**Files:**
- Modify: `src/components/ControlPanel.jsx` (full rewrite)

**Interfaces:**
- Consumes: new props `theme:'dark'|'light'`, `onThemeChange(value)`, `range:number|null`, `onRangeChange(ms)` — in addition to the existing ones.
- Produces: `ControlPanel` prop signature `{ mapMode, onMapModeChange, basemap, onBasemapChange, cameraMode, onCameraModeChange, onReset, onFlyover, maintenance, onMaintenanceToggle, theme, onThemeChange, range, onRangeChange }`.

- [ ] **Step 1: Rewrite `src/components/ControlPanel.jsx`** with EXACTLY this content (adds the local `RANGES`, the Teema section, and the Aikaväli section; keeps all existing sections):

```jsx
// Ohjauspaneeli: napit näkymälle (2D/3D), pohjakartalle, kameralle, teemalle,
// kaavioiden aikavälille ja huoltotilalle. Renderöidään erillisen ohjausikkunan
// sisään (täyttää ikkunan). Tila ja takaisinkutsut tulevat isännältä.

// Kaavioiden aikavälit (sama lista kuin ennen koontinäytön yläpalkissa).
const RANGES = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: 'MAX', ms: null },
];

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
  theme,
  onThemeChange,
  range,
  onRangeChange,
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
        <span className="control-label">Teema</span>
        <div className="control-row">
          <button
            className={`range-btn${theme === 'dark' ? ' active' : ''}`}
            onClick={() => onThemeChange('dark')}
          >
            Tumma
          </button>
          <button
            className={`range-btn${theme === 'light' ? ' active' : ''}`}
            onClick={() => onThemeChange('light')}
          >
            Vaalea
          </button>
        </div>
      </div>

      <div className="control-section">
        <span className="control-label">Aikaväli</span>
        <div className="control-row">
          {RANGES.map((r) => (
            <button
              key={r.label}
              className={`range-btn${range === r.ms ? ' active' : ''}`}
              onClick={() => onRangeChange(r.ms)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

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

- [ ] **Step 2: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 3: Build.** Run `npm run build` — expected: success.
- [ ] **Step 4: Commit.**

```bash
git add src/components/ControlPanel.jsx
git commit -m "Add Teema + Aikaväli sections to the control panel"
```

---

## Task 5: Wire theme + range through the control window

Passes the new state and commands from the control window into the panel — completing the live sync.

**Files:**
- Modify: `src/ControlWindow.jsx`

**Interfaces:**
- Consumes: `state.theme`, `state.range` (already present in the state messages and `readPersistedState()` after Tasks 2–3); `command('setTheme'|'setRange', value)`.
- Produces: nothing new.

- [ ] **Step 1: Pass theme + range props/commands to `ControlPanel`.** In `src/ControlWindow.jsx` find:

```jsx
        onReset={() => command('reset')}
        onFlyover={() => command('lento')}
        maintenance={state.maintenance}
        onMaintenanceToggle={() => command('setMaintenance', !state.maintenance)}
      />
```
Replace with:
```jsx
        onReset={() => command('reset')}
        onFlyover={() => command('lento')}
        maintenance={state.maintenance}
        onMaintenanceToggle={() => command('setMaintenance', !state.maintenance)}
        theme={state.theme}
        onThemeChange={(v) => command('setTheme', v)}
        range={state.range}
        onRangeChange={(v) => command('setRange', v)}
      />
```

- [ ] **Step 2: Lint.** Run `npm run lint` — expected: no errors.
- [ ] **Step 3: Build.** Run `npm run build` — expected: success.
- [ ] **Step 4: Manual check (hand to user).** Open the dashboard, then click the gear to open the control window. The dashboard header no longer shows the 1m–MAX range buttons or the sun/moon theme toggle. In the control window: **Teema** → Tumma/Vaalea switches the dashboard light/dark live and highlights the active theme; **Aikaväli** → 1m/5m/30m/1h/MAX changes the charts' window live and highlights the active range. Reload either window → theme and range persist and the control panel reflects them. No console errors.
- [ ] **Step 5: Commit.**

```bash
git add src/ControlWindow.jsx
git commit -m "Wire theme + range through the control window"
```

---

## Notes for the executor

- Keep all comments/strings Finnish; keep the always-dark surfaces hardcoded.
- Task 1 is independent. Tasks 2 → 3 → 4 → 5 are sequential (each builds green on its own, but the migration is only functionally complete after Task 5).
- The placeholder `public/maintenance-logo.svg` exists so the splash isn't a broken image before the user supplies the real logo; the user overwrites that file (or renames and updates the `LOGOS` entry).
