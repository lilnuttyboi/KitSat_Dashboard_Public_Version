import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useTelemetry } from './hooks/useTelemetry';
import LatestImage from './components/LatestImage';
import FlightTimer from './components/FlightTimer';
import MaintenanceOverlay from './components/MaintenanceOverlay';
import ControlPanel from './components/ControlPanel';
import { readPersistedState, writePersistedState } from './lib/controlState';
import './App.css';

// Lazy-ladataan raskaat riippuvuudet (leaflet, recharts) omiin chunkkeihinsa,
// jotta ensilatauksen nippu pienenee.
const MapComponent = lazy(() => import('./components/MapComponent'));
const Globe3D = lazy(() => import('./components/Globe3D'));
const MetricChart = lazy(() => import('./components/MetricChart'));

const ROUTE_MAX_POINTS = 2000;

// Teema: käyttäjän tallentama valinta voittaa, muuten käyttöjärjestelmän oletus.
const getInitialTheme = () => {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Seurataan käyttöjärjestelmän teemaa niin kauan kuin käyttäjä ei ole
  // tehnyt omaa valintaa.
  useEffect(() => {
    if (localStorage.getItem('theme')) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e) => setTheme(e.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
}

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

// Mittarikortti: otsikko ikonilla, nykyarvo, valinnainen min/max-rivi ja kaavio.
function MetricCard({ title, value, unit, metaLabel, metaValue, history, dataKey, color, rangeMs, large = false, className, yUnit, yScale, yDecimals, showAxisUnits }) {
  return (
    <div className={className ? `glass-card ${className}` : 'glass-card'}>
      <div className="metric-head">
        <h3 className="label">{title}</h3>
        {metaLabel && (
          <span className="metric-meta">
            {metaLabel}<strong>{metaValue != null ? metaValue.toFixed(1) : '--'}</strong>{unit}
          </span>
        )}
      </div>
      <p className={large ? 'value-large' : 'value-medium'}>
        {value?.toFixed(1) ?? '--'}<span className="unit">{unit}</span>
      </p>
      <MetricChart history={history} dataKey={dataKey} unit={unit} color={color} rangeMs={rangeMs} yUnit={yUnit} yScale={yScale} yDecimals={yDecimals} showAxisUnits={showAxisUnits} />
    </div>
  );
}

function App() {
  const { telemetry, history, loading, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs } = useTelemetry();
  const [rangeMs, setRangeMs] = useState(() => readPersistedState().range); // ms tai null (MAX)
  const [theme, , setThemeChoice] = useTheme(); // setThemeChoice: ohjauspaneelin Teema-komento
  // Säätötila siemennetään pysyvyydestä, jotta koontinäytön lataus palauttaa
  // viimeisimmät valinnat (ja täsmää ohjausikkunan kanssa).
  const [mapMode, setMapMode] = useState(() => readPersistedState().mapMode);       // '2d' | '3d'
  const [basemap, setBasemap] = useState(() => readPersistedState().basemap);       // 'satellite' | 'kartta'
  const [cameraMode, setCameraMode] = useState(() => readPersistedState().cameraMode); // 'sivu' | 'kierto' | 'ylha'
  const [resetNonce, setResetNonce] = useState(0);       // bump -> Globe3D kehystää uudelleen
  const [flyoverNonce, setFlyoverNonce] = useState(0);   // bump -> Globe3D lentää reitin yli
  const [maintenance, setMaintenance] = useState(() => readPersistedState().maintenance); // huoltotila
  const [axisUnits, setAxisUnits] = useState(() => readPersistedState().axisUnits); // kaavioiden Y-akselin asteikko
  const [controlOpen, setControlOpen] = useState(false); // onko asetuspaneeli auki (samassa välilehdessä)

  // Säilö säätötila localStorageen, jotta valinnat palautuvat sivun latauksessa.
  // HUOM: `theme` säilötään myös tähän nappien korostusta varten, mutta teeman
  // varsinainen lähde on useTheme + localStorage('theme') (säilyttää
  // käyttöjärjestelmäseurannan). Älä siemennä koontinäytön teemaa tästä tilasta.
  useEffect(() => {
    writePersistedState({ mapMode, basemap, cameraMode, maintenance, theme, range: rangeMs, axisUnits });
  }, [mapMode, basemap, cameraMode, maintenance, theme, rangeMs, axisUnits]);

  const route = useMemo(() => buildRoute(history), [history]);
  const route3d = useMemo(() => buildRoute3d(history), [history]);

  if (loading) {
    return <div className="loading">YHDISTETÄÄN OHJAUSKESKUKSEEN...</div>;
  }

  return (
    <>
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>PSL-1R // Public dashboard</h1>
          <div className="flight-id">
            <span className="flight-id-label">Flight ID</span>
            <span>{telemetry?.flight_id ?? '--'}</span>
          </div>
          <div className="flight-time">
            <span className="flight-time-label">Lentoaika</span>
            <FlightTimer startMs={flightStartMs} lastDataMs={lastDataMs} />
          </div>
        </div>
        <div className="header-right">
          {!controlOpen && !maintenance && (
            <button
              className="open-control-btn"
              onClick={() => setControlOpen(true)}
              title="Avaa asetukset"
            >
              Asetukset
            </button>
          )}
          <div className={`status-indicator ${status}`}>
            <span className="status-dot"></span>
            {status === 'online' ? 'VERKOSSA' : 'EI YHTEYTTÄ'}
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        <Suspense fallback={<div className="loading">LADATAAN…</div>}>
          {/* Korkeuskäyrä on keltainen molemmissa teemoissa (light-teeman
              --primary on tummempi amber, joten väri kovakoodataan) */}
          <MetricCard
            className="altitude-section"
            large
            title="Korkeus"
            value={telemetry?.gps_alt}
            unit="m"
            metaLabel="MAX"
            metaValue={maxAlt}
            history={history}
            dataKey="alt"
            color="#fbbf24"
            rangeMs={rangeMs}
            showAxisUnits={axisUnits}
          />

          <div className="metrics-row left-metrics">
            <MetricCard
              title="Lämpötila"
              value={telemetry?.temp_c}
              unit="°C"
              metaLabel="MIN"
              metaValue={minTemp}
              history={history}
              dataKey="temp"
              color="var(--accent)"
              rangeMs={rangeMs}
              showAxisUnits={axisUnits}
            />
            {/* Ilmanpaineen kaavio ja asteikko käyttävät samaa yksikköä kuin
                päämittari (hPa), jottei kPa/hPa-ero hämmennä katsojaa. */}
            <MetricCard
              title="Ilmanpaine"
              value={telemetry?.pressure_hpa}
              unit="hPa"
              history={history}
              dataKey="pressure"
              color="var(--success)"
              rangeMs={rangeMs}
              showAxisUnits={axisUnits}
            />
          </div>

          <div className="glass-card map-section">
            {/* Karttatyyppi (2D/3D) valitaan vain ohjauspaneelista — ei kartalla. */}
            <Suspense fallback={<div className="globe-overlay">LADATAAN KARTTAA…</div>}>
              {mapMode === '3d' ? (
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
              ) : (
                <MapComponent
                  lat={telemetry?.gps_fix ? telemetry.gps_lat : null}
                  lng={telemetry?.gps_fix ? telemetry.gps_lon : null}
                  route={route}
                  theme={theme}
                  basemap={basemap}
                />
              )}
            </Suspense>
          </div>

          <div className="metrics-row right-metrics">
            <MetricCard
              title="Nopeus"
              value={telemetry?.gps_speed}
              unit="m/s"
              metaLabel="MAX"
              metaValue={maxSpeed}
              history={history}
              dataKey="speed"
              color="var(--error)"
              rangeMs={rangeMs}
              showAxisUnits={axisUnits}
            />
            <div className="glass-card image-section">
              <h3 className="label">Viimeisin kuva</h3>
              <LatestImage />
            </div>
          </div>
        </Suspense>
      </main>
    </div>
    {maintenance && <MaintenanceOverlay />}
    {/* Asetukset-nappi tietoja-ruudun PÄÄLLE: ainoa tapa avata paneeli takaisin,
        kun ruutu peittää yläpalkin napin. Näkyy vain kun paneeli ei ole auki. */}
    {maintenance && !controlOpen && (
      <button
        className="maintenance-launcher"
        onClick={() => setControlOpen(true)}
        title="Avaa asetukset"
      >
        Asetukset
      </button>
    )}
    {/* Kelluva asetuspaneeli samassa välilehdessä; pysyy auki kunnes suljetaan.
        Renderöidään juuritasolla (z-index tietoja-ruudun yläpuolella). */}
    {controlOpen && (
      <ControlPanel
        mapMode={mapMode}
        onMapModeChange={setMapMode}
        basemap={basemap}
        onBasemapChange={setBasemap}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        onReset={() => setResetNonce((n) => n + 1)}
        onFlyover={() => setFlyoverNonce((n) => n + 1)}
        maintenance={maintenance}
        onMaintenanceToggle={() => setMaintenance((m) => !m)}
        theme={theme}
        onThemeChange={setThemeChoice}
        range={rangeMs}
        onRangeChange={setRangeMs}
        axisUnits={axisUnits}
        onAxisUnitsToggle={() => setAxisUnits((a) => !a)}
        onClose={() => setControlOpen(false)}
      />
    )}
    </>
  );
}

export default App;
