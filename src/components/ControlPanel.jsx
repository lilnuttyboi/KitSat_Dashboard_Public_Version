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
