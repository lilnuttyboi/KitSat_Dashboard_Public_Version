# Design — Separate control window, cinematic Lento, maintenance polish

Date: 2026-06-21
Status: Approved (brainstorming)

## Context

The dashboard (`src/App.jsx`) is a single-window React 19 + Vite SPA. Operator
controls live in an **in-page** floating `ControlPanel` overlay plus a `⚙`
launcher, both rendered inside the dashboard window. Because the dashboard is
shown to an audience on a TV (via HDMI, mirroring/extending the operator's
laptop), the control panel unavoidably appears on the audience screen — there
is no way to keep it on the operator's laptop only.

This app is **local-only** (operator's computer + a TV over HDMI, never hosted).
That removes multi-user / security concerns and makes `BroadcastChannel` +
`window.open` a perfectly good cross-window mechanism.

All current control state lives in `App.jsx`:
`mapMode` (`'2d'|'3d'`), `basemap` (`'satellite'|'kartta'`),
`cameraMode` (`'sivu'|'kierto'|'ylha'`), `resetNonce`, `flyoverNonce`,
`maintenance`, plus `panelOpen` (in-page panel visibility — removed by this work).

The 2D/3D toggle currently sits as buttons overlaid on the map itself
(`App.jsx` ~lines 229–236), i.e. also on the audience screen.

This design covers three independent changes:
1. Move the control panel into a genuinely separate browser window.
2. Make the "Lento" camera fly-over slow, cinematic, and end in a persistent
   satellite-follow.
3. Polish the maintenance splash.

## Goals / non-goals

**Goals**
- The audience/TV window shows **zero operator controls** while the operator is
  driving from a separate window on the laptop.
- The dashboard still works **standalone** (controls reappear when no control
  window is connected) so nothing breaks if the operator never opens one.
- Live, low-latency sync between the two windows on the same machine.

**Non-goals**
- Moving the time-range (1m/5m/30m/1h/MAX) and theme toggle off the dashboard —
  they stay on the dashboard for now.
- Any networked/remote control (this is same-origin, same-machine only).
- Any change to the data layer (`src/hooks/`), telemetry, or image polling.

---

## 1. Separate control window

### Routing (hash switch, no router dependency)

`src/main.jsx` decides what to mount from `window.location.hash`:
- `#ohjaus` → mount a lightweight `<ControlWindow/>` (controls + sync channel
  only — **no** maps, Cesium, telemetry, or image polling).
- anything else → mount the dashboard `<App/>` as today.

The operator opens the control window as a second browser window at the app URL
with `#ohjaus` appended, and drags it to the laptop screen. Reloading either
window preserves its role (the hash persists).

### Cross-window sync — `src/lib/controlChannel.js`

A thin, well-bounded module wrapping one `BroadcastChannel('kitsat-control')`
plus `localStorage` for cold-start/persistence. It is the only place that knows
the wire format.

**Source of truth:** the **dashboard** owns all state (it already does and it is
the renderer). The control window is a remote: it sends *commands* and reflects
*state snapshots* echoed back.

**Synced settings** (persisted to `localStorage` key `kitsatControlState`, and
broadcast on every change):
`{ mapMode, basemap, cameraMode, maintenance }`.

**Message protocol** (all messages `{type, ...}`):
- `{type:'command', name, value?}` — control → dashboard. Names:
  `setMapMode` (`'2d'|'3d'`), `setBasemap` (`'satellite'|'kartta'`),
  `setCameraMode` (`'sivu'|'kierto'|'ylha'`), `setMaintenance` (boolean),
  `reset` (no value — dashboard bumps `resetNonce`),
  `lento` (no value — dashboard bumps `flyoverNonce`).
- `{type:'state', state}` — dashboard → control. The full synced-settings
  snapshot, sent on any state change and in reply to `hello`.
- `{type:'hello'}` — control → dashboard, on control-window mount. Dashboard
  replies with a `state` message and marks a control window **connected**.
- `{type:'bye'}` — control → dashboard, on control-window `beforeunload`.
  Dashboard marks **disconnected**.

`reset` and `lento` are momentary events, not part of the persisted snapshot.

Module surface (framework-agnostic, testable in isolation):
- `createControlChannel()` → `{ post(msg), subscribe(handler) → unsubscribe, close() }`
- `readPersistedState()` / `writePersistedState(state)` — localStorage helpers,
  defaulting to the same initial values `App.jsx` uses today
  (`mapMode:'3d'`, `basemap:'satellite'`, `cameraMode:'sivu'`, `maintenance:false`).

### Dashboard changes (`src/App.jsx`)

- Remove the in-page `<ControlPanel>` and the `.control-launcher` `⚙` button.
- Subscribe to the channel on mount: apply incoming `command` messages to the
  existing setters (`setMapMode`, `setBasemap`, `setCameraMode`,
  `setMaintenance`, `setResetNonce(n=>n+1)`, `setFlyoverNonce(n=>n+1)`); on
  `hello`, reply with current `state` and set `controlConnected = true`; on
  `bye`, set `controlConnected = false`.
- Broadcast a `state` snapshot whenever `mapMode`/`basemap`/`cameraMode`/
  `maintenance` change, and persist it to `localStorage`.
- On mount, seed state from `readPersistedState()` so a dashboard reload restores
  the last settings.
- **Audience-clean:** when `controlConnected` is true, hide every on-dashboard
  control — the new "Avaa ohjaus" button **and** the on-map 2D/3D toggle. When
  false, show them (standalone still works).
- Add a small **text** button "Avaa ohjaus" (no gear icon) in a dashboard corner
  that runs `window.open(<url>#ohjaus, 'kitsat-ohjaus', 'width=420,height=720')`.
  It is one of the controls hidden once connected.
- `MaintenanceOverlay` continues to render on the dashboard when `maintenance`
  is true (unchanged placement; z-index unchanged).

### Control window (`src/ControlWindow.jsx`)

- Full-window host for the controls. Seeds its reflected state from
  `readPersistedState()`, sends `hello` on mount and `bye` on unload, listens for
  `state` snapshots to keep button highlighting in sync, and posts `command`
  messages on every control interaction.
- Renders `<ControlPanel/>` (see below) filling the window.

### `ControlPanel.jsx` changes

- **Drop** the drag/pointer-capture, viewport-clamping, `controlPanelPos`
  `localStorage`, and the fixed-window/titlebar chrome — it now fills the control
  window instead of floating over the dashboard. Keep the `×`/close? No — the
  control window is closed by closing the OS window, so remove the close button.
- **Add** a "Näkymä" section with the 2D/3D toggle (`Satelliitti`/`Kartta` stays
  under "Pohjakartta"; the new section switches `mapMode`).
- Keep sections: Näkymä (2D/3D), Pohjakartta (Satelliitti/Kartta),
  Kamera (Sivu/Kierto/Ylhäältä + Lento; disabled when `mapMode==='2d'`),
  Palauta näkymä, Huolto (Huoltotila toggle).
- Props become value + callback pairs driven by the control window:
  `mapMode/onMapModeChange`, `basemap/onBasemapChange`,
  `cameraMode/onCameraModeChange`, `onReset`, `onFlyover`,
  `maintenance/onMaintenanceToggle`. (No `onClose`, no position props.)

### CSS

- Remove `.control-window` drag/titlebar and `.control-launcher` styles that no
  longer apply; restyle `ControlPanel` to fill the control window (full-width,
  comfortable for a small laptop window). Keep the hardcoded dark palette.

### Edge cases
- Control window opened before the dashboard: its `hello` is missed, but it seeds
  from `localStorage`; the dashboard **broadcasts a `state` snapshot on its own
  mount** (in addition to replying to `hello`), so a control window that started
  first converges as soon as the dashboard appears.
- Two control windows: harmless — both send commands, both reflect state. Not a
  supported workflow but does not break.
- `BroadcastChannel` is supported in all current desktop browsers; this is a
  local desktop app, so no fallback is required.

---

## 2. Cinematic Lento (`src/components/Globe3D.jsx`)

Replace the single 4s "frame the whole route then snap to selected mode"
fly-over with a slow, eased, two-phase move that ends in a persistent follow:

- **Phase 1 — route sweep:** `flyToBoundingSphere(routeSphere)` with a long
  duration (`LENTO_SWEEP_SEC`, ~12s) and `easingFunction:
  Cesium.EasingFunction.QUADRATIC_IN_OUT` for a cinematic ease (up from the
  current abrupt 4s linear move).
- **Phase 2 — settle onto satellite:** on phase-1 `complete`, a second eased
  `flyToBoundingSphere(satelliteSphere)` (~`LENTO_SETTLE_SEC`, ~5s) into a
  pulled-back cinematic 3/4 follow pose.
- **Hold — `'lento'` follow:** on phase-2 `complete`, lock a new internal follow
  state that keeps tracking the satellite each frame (preRender) using the
  pulled-back framing. It persists indefinitely.

**Exit:** only `resetNonce` (the "Palauta näkymä" button) leaves the `'lento'`
follow — `flyToCurrentPose` restores the selected `cameraMode` (default Sivu).
Switching `cameraMode` while in `'lento'` also exits naturally (the existing
`cameraMode` effect re-enables mode tracking); reset remains the canonical exit.

**Implementation notes:**
- Add a `lentoFollowRef`/internal mode so the existing preRender tracking branch
  renders the pulled-back follow framing when active, mirroring the `sivu`/
  `kierto`/`ylha` branches (reuse `trackHpr`, no per-frame allocation).
- All timings/angles in named constants near the existing `FLYOVER_DURATION`
  (which is replaced): `LENTO_SWEEP_SEC`, `LENTO_SETTLE_SEC`, and the follow
  pose's heading/pitch/range factor.
- Guard both phases against an unmounted/destroyed viewer (the controller already
  established the stale-closure-via-refs pattern in this file — follow it).

---

## 3. Maintenance splash polish (`src/components/MaintenanceOverlay.jsx` + CSS)

- **One-line logo:** `.maintenance-logo` gets `white-space: nowrap`; size shrinks
  to fit narrow viewports (keep a `clamp()` lower bound; the constraint is no
  wrap). `PORI SPACE LAB` must render on a single line.
- **Remove the gear:** delete the spinning `.maintenance-gear` `⚙` element, its
  CSS rule, the `@keyframes maint-spin`, and the reduced-motion rule that only
  guarded it.
- **Status text:** `STATUS` constant → `'Huoltotoimet käynnissä'`.
- **Looping typewriter funny line:** the `FUNNY` line animates as a typewriter:
  types `Ruuvataan vielä pari pulttia kiinni palaamme pian...` (no em-dash),
  holds, backspaces to empty, then repeats — looping while maintenance is on.
  - Implement with a small self-contained effect/timer inside `MaintenanceOverlay`
    (or a tiny `useTypewriter` helper) driving the displayed substring; a blinking
    caret (`|`) is shown during animation. Timers cleared on unmount.
  - Under `prefers-reduced-motion: reduce`, show the **full static text** (no
    type/backspace), via a media-query check so reduced-motion users get the
    final string immediately.

---

## Testing / verification

No test suite (project convention). Verify each piece with:
- `npm run lint` → no errors.
- `npm run build` → succeeds.
- Manual (operator, no browser in agent env — handed to user):
  1. Open dashboard + a second window at `#ohjaus`; confirm the dashboard hides
     its "Avaa ohjaus" button and on-map 2D/3D toggle once the control window is
     open, and shows them again when it is closed.
  2. From the control window, toggle 2D/3D, basemap, camera modes, maintenance —
     all reflect on the dashboard live; button highlights track dashboard state.
  3. Reload each window independently; settings persist; roles persist.
  4. Lento: visibly slow/eased sweep, settles onto the satellite, keeps following
     until "Palauta näkymä" is pressed.
  5. Maintenance splash: `PORI SPACE LAB` on one line, no gear, status reads
     "Huoltotoimet käynnissä", funny line types/backspaces/loops without the dash.

## Conventions

- All UI strings and code comments in **Finnish**.
- Always-dark control + splash palettes stay hardcoded (theme-independent).
- Data layer untouched.
