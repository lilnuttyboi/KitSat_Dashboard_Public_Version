# Branded Maintenance Splash & Control-Panel Migration — Design Spec

**Date:** 2026-06-22
**Status:** Approved (brainstorming)

## Goal

Three changes to the KitSat public dashboard:

1. Turn the maintenance splash (`huoltotila`) into a **pure-branding** screen: a centered logo (image file, scalable to several logos later) with an optional tagline slot — dropping the status line and the looping typewriter funny line.
2. Move the **night-mode (theme) toggle** out of the dashboard header into the separate control window.
3. Move the **time-range buttons** (1m / 5m / 30m / 1h / MAX) out of the dashboard header into the separate control window.

For (2) and (3) the choice is **control-panel-only**: the header controls are removed entirely; theme and range are changeable **only** from the `#ohjaus` control window.

## Constraints (inherited)

- **No test suite.** Verify with `npm run lint` (no errors) and `npm run build` (succeeds). Manual visual checks go to the user.
- **All UI strings and code comments in Finnish.**
- **Data layer untouched** — no changes under `src/hooks/` (`useTheme` lives in `App.jsx`, so it is in scope).
- **Always-dark surfaces** (control window, maintenance splash) hardcode their colors; never bind to theme CSS vars.
- **Local-only app**; `BroadcastChannel` + `localStorage` sync, no network concerns.

## Accepted trade-off

With **control-panel-only**, a dashboard opened *without* a control window cannot change theme or range: it stays at the OS-default theme and the 1m range. This is intended.

---

## Part A — Branded maintenance splash

### Component: `src/components/MaintenanceOverlay.jsx` (rewrite)

Replace the text wordmark + status + typewriter with a logo row + optional tagline.

- **`LOGOS` constant** — an array of `{ src, alt }`. Currently **one** entry:
  - `src` resolves through Vite's base URL so it works under any deploy path:
    `` `${import.meta.env.BASE_URL}maintenance-logo.svg` ``
  - `alt: 'Pori Space Lab'`
  - The array is rendered as a centered horizontal row (`flex-wrap`, `gap`). Adding more `{ src, alt }` entries later requires **no markup/CSS change** — the row simply grows and wraps.
- **`TAGLINE` constant** — a string, **`''` (empty) for now**. Rendered only when non-empty (`{TAGLINE && <p className="maintenance-tagline">{TAGLINE}</p>}`). Filling it later makes the tagline appear; no other change needed.
- **Removed:** `LOGO`, `STATUS`, `FUNNY`, the typing-time constants, `prefersReducedMotion`, the entire `useTypewriter` hook, the caret span, and the `useEffect`/`useRef`/`useState` imports (no longer needed).
- **Accessibility:** keep `role="status" aria-live="polite"` on the overlay; each logo `<img>` carries its `alt`.

Resulting JSX shape:

```jsx
const LOGOS = [
  { src: `${import.meta.env.BASE_URL}maintenance-logo.svg`, alt: 'Pori Space Lab' },
];
const TAGLINE = ''; // valinnainen iskulause — täytä myöhemmin, näkyy automaattisesti

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

### Logo asset

The user provides the logo file and drops it into **`public/`** named **`maintenance-logo.svg`** (if a different name/extension is used, update the `LOGOS` entry to match). Because the splash background is dark (`#04060f`), the logo should be **light or transparent** to read well.

### CSS: `src/App.css`

- Keep `.maintenance-overlay` and `.maintenance-inner` as-is.
- **Replace** `.maintenance-logo` with:
  - `.maintenance-logos` — `display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap: clamp(1.5rem, 4vw, 3rem);`
  - `.maintenance-logo-img` — `max-height: clamp(4rem, 16vw, 9rem); max-width: 80vw; width:auto; height:auto; object-fit:contain;` (so logos of differing aspect ratios share a height baseline and scale on small screens).
- **Add** `.maintenance-tagline` — `margin:0; font-family: var(--font-display); font-size: clamp(0.9rem, 2vw, 1.4rem); letter-spacing: 0.15em; color:#94a3b8;` (ready for when `TAGLINE` is filled).
- **Delete** `.maintenance-status`, `.maintenance-funny`, `.maintenance-caret`, the `@keyframes maint-caret-blink`, and the `@media (prefers-reduced-motion: reduce){ .maintenance-caret }` block — all now unused.

---

## Part B — Theme + range → control window only

### Synced state shape (extended)

`src/lib/controlChannel.js` `DEFAULT_STATE` grows from
`{ mapMode, basemap, cameraMode, maintenance }` to add:

- **`theme: 'dark'`** — `'dark' | 'light'`
- **`range: 60000`** — milliseconds, or **`null`** for MAX (JSON serializes `null` correctly)

Two new command names (control → dashboard): **`setTheme`**, **`setRange`**.

### `src/lib/controlChannel.js`

Add `theme: 'dark'` and `range: 60000` to `DEFAULT_STATE`. No other changes (read/write/channel helpers are generic).

### `src/App.jsx`

**Theme owner stays `useTheme`** (OS-follow + `localStorage('theme')` preserved). Extend `useTheme` to expose a direct value setter so the control command can set an explicit value:

- Change `useTheme` to return `[theme, toggleTheme, setThemeChoice]`, where `setThemeChoice(value)` sets the theme to `'dark'|'light'` and writes `localStorage('theme')` (same persistence path `toggleTheme` already uses). `toggleTheme` may be implemented in terms of `setThemeChoice`. The header no longer calls `toggleTheme` (button removed), but it stays exported for clarity/use by the command handler.
- Destructure: `const [theme, , setThemeChoice] = useTheme();` (toggle unused now).

**Range** is seeded from persistence like the others:
- `const [rangeMs, setRangeMs] = useState(() => readPersistedState().range);`

**Command handlers** — add to the `switch (msg.name)`:
- `case 'setTheme': setThemeChoice(msg.value === 'light' ? 'light' : 'dark'); break;`
- `case 'setRange': setRangeMs(msg.value); break;` (value is `number | null`)

**Broadcast snapshot** — include theme + range so the control window reflects them:
- `stateRef` seed and the broadcast effect's `snapshot` become `{ mapMode, basemap, cameraMode, maintenance, theme, range: rangeMs }`.
- The broadcast effect's dependency array adds `theme` and `rangeMs`:
  `}, [mapMode, basemap, cameraMode, maintenance, theme, rangeMs]);`

**Header cleanup** — remove from the JSX:
- The entire `.header-range` block (the `RANGES.map(...)` buttons).
- The `.theme-btn` button in `.header-right` (the sun/moon toggle).
- `RANGES` stays (now consumed by `ControlPanel`, imported there or passed down — see below). `ICONS.sun`/`ICONS.moon` may become unused; remove them only if lint flags it.

### `RANGES` source

`ControlPanel` needs the 1m–MAX list. To avoid duplicating it, **move the `RANGES` constant into `ControlPanel.jsx`** (it is purely a UI control list, no longer used by `App.jsx` once the header block is gone). `App.jsx` drops its `RANGES` definition. `rangeMs` values flow as `number | null`.

### `src/components/ControlPanel.jsx`

Add two new props and two new sections. New prop signature:

```
{ mapMode, onMapModeChange, basemap, onBasemapChange, cameraMode, onCameraModeChange,
  onReset, onFlyover, maintenance, onMaintenanceToggle,
  theme, onThemeChange, range, onRangeChange }
```

- **Teema** section (after Pohjakartta or near the top): two buttons `Tumma` (`theme==='dark'`) and `Vaalea` (`theme==='light'`), each `range-btn` with `.active` on the current value, calling `onThemeChange('dark'|'light')`.
- **Aikaväli** section: the `RANGES` buttons (`1m/5m/30m/1h/MAX`), `range-btn` with `.active` when `range === r.ms`, calling `onRangeChange(r.ms)`. (`MAX` → `r.ms === null`.)

Both use existing `.control-section` / `.control-row` / `.range-btn` styles — no new CSS required.

### `src/ControlWindow.jsx`

Pass the new state + commands through:

```jsx
theme={state.theme}
onThemeChange={(v) => command('setTheme', v)}
range={state.range}
onRangeChange={(v) => command('setRange', v)}
```

(`state` already comes from `readPersistedState()` then live `state` messages, both of which now include `theme` and `range`.)

---

## Files touched

| File | Change |
|------|--------|
| `src/components/MaintenanceOverlay.jsx` | Rewrite → logo row + optional tagline; remove typewriter |
| `src/App.css` | Splash: logo-row + tagline styles, delete status/funny/caret rules. (Header `.header-range`/`.theme-btn` rules may be left or removed if unused.) |
| `src/lib/controlChannel.js` | `DEFAULT_STATE` += `theme`, `range` |
| `src/App.jsx` | `useTheme` value-setter; seed `rangeMs` from persistence; `setTheme`/`setRange` handlers; snapshot + deps += theme/range; remove header range block + theme button; drop `RANGES` |
| `src/components/ControlPanel.jsx` | Own `RANGES`; add Teema + Aikaväli sections + props |
| `src/ControlWindow.jsx` | Pass `theme`/`range` + `setTheme`/`setRange` commands |
| `public/maintenance-logo.svg` | New asset, provided by user |

**Out of scope:** `src/hooks/` data layer, map/chart internals, the 2D/3D toggle behavior, the gear "Avaa ohjaus" button.

## Verification

- `npm run lint` → no errors.
- `npm run build` → succeeds.
- Manual (user): Huoltotila shows the centered logo on the dark splash (no status/typewriter); control window's Teema switches the dashboard light/dark live and the button highlights the active theme; Aikaväli switches the charts' window live and highlights the active range; the dashboard header no longer shows range buttons or the theme toggle; settings persist across reloads and reflect into a freshly opened control window.
