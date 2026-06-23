// Ohjauspaneeli (Asetukset): kelluva, raahattava paneeli koontinäytön päällä
// samassa välilehdessä. Napit näkymälle (2D/3D), pohjakartalle, kameralle,
// kaavioiden aikavälille, Y-akselin asteikolle ja tietoja-ruudulle.
// Tila ja takaisinkutsut tulevat isännältä (App). Pysyy auki kunnes suljetaan.
import { useCallback, useEffect, useRef, useState } from 'react';

const POS_KEY = 'controlPanelPos';
const PANEL_W = 240; // px — leveys reunarajausta ja oletussijaintia varten

// Kaavioiden aikavälit (sama lista kuin ennen koontinäytön yläpalkissa).
const RANGES = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: 'MAX', ms: null },
];

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// Lue tallennettu sijainti; oletus oikeaan yläkulmaan otsikon alapuolelle.
function readPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      // Rajaa nykyiseen ikkunaan: työpöydällä tallennettu sijainti jäisi muuten
      // mobiiliruudun ulkopuolelle, eikä paneeli näkyisi lainkaan.
      return {
        x: clamp(p.x, 0, Math.max(0, window.innerWidth - PANEL_W)),
        y: clamp(p.y, 0, Math.max(0, window.innerHeight - 80)),
      };
    }
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
  range,
  onRangeChange,
  axisUnits,
  onAxisUnitsToggle,
  onClose,
}) {
  const [pos, setPos] = useState(readPos);
  const panelRef = useRef(null);
  const dragRef = useRef(null); // { dx, dy }: osoittimen ja paneelin kulman ero

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
        <span className="control-title">ASETUKSET</span>
        <button
          className="control-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label="Sulje asetukset"
          title="Sulje"
        >
          ×
        </button>
      </div>

      <div className="control-body">
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
          <span className="control-label">Asteikko</span>
          <button
            className={`range-btn control-wide${axisUnits ? ' active' : ''}`}
            onClick={onAxisUnitsToggle}
          >
            {axisUnits ? 'Piilota asteikko' : 'Näytä asteikko'}
          </button>
        </div>

        <div className="control-section">
          <span className="control-label">Tietoja-ruutu</span>
          <button
            className={`range-btn control-wide${maintenance ? ' active' : ''}`}
            onClick={onMaintenanceToggle}
          >
            {maintenance ? 'Sulje tiedot' : 'Näytä tiedot'}
          </button>
        </div>
      </div>
    </div>
  );
}
