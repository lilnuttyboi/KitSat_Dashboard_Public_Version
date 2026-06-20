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
