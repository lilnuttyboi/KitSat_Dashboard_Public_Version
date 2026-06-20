import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useTelemetry } from './hooks/useTelemetry';
import LatestImage from './components/LatestImage';
import FlightTimer from './components/FlightTimer';
import './App.css';

// Lazy-ladataan raskaat riippuvuudet (leaflet, recharts) omiin chunkkeihinsa,
// jotta ensilatauksen nippu pienenee.
const MapComponent = lazy(() => import('./components/MapComponent'));
const Globe3D = lazy(() => import('./components/Globe3D'));
const MetricChart = lazy(() => import('./components/MetricChart'));

const RANGES = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: 'MAX', ms: null },
];

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

  return [theme, toggleTheme];
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
function MetricCard({ title, value, unit, metaLabel, metaValue, history, dataKey, color, rangeMs, large = false, className, yUnit, yScale, yDecimals }) {
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
      <MetricChart history={history} dataKey={dataKey} unit={unit} color={color} rangeMs={rangeMs} yUnit={yUnit} yScale={yScale} yDecimals={yDecimals} />
    </div>
  );
}

function App() {
  const { telemetry, history, loading, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs } = useTelemetry();
  const [rangeMs, setRangeMs] = useState(60_000);
  const [theme, toggleTheme] = useTheme();
  const [mapMode, setMapMode] = useState('3d'); // '3d' = oletus (näyttävin yleisölle)
  const [basemap] = useState('satellite'); // pohjakartta 2D-kartalle; asetus lisätään myöhemmin
  const route = useMemo(() => buildRoute(history), [history]);
  const route3d = useMemo(() => buildRoute3d(history), [history]);

  if (loading) {
    return <div className="loading">YHDISTETÄÄN OHJAUSKESKUKSEEN...</div>;
  }

  return (
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
        </div>
        <div className="header-right">
          <button className="range-btn theme-btn" onClick={toggleTheme} aria-label="Vaihda teema" title="Vaihda teema">
            {theme === 'dark' ? ICONS.sun : ICONS.moon}
          </button>
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
            />
            {/* Kaaviossa ilmanpaine näytetään kilopascaleina (1 kPa = 10 hPa),
                jotta lukema on lyhyempi kuin hPa:na (esim. "100.78 kPa").
                Päämittari pysyy hehtopascaleina. */}
            <MetricCard
              title="Ilmanpaine"
              value={telemetry?.pressure_hpa}
              unit="hPa"
              history={history}
              dataKey="pressure"
              color="var(--success)"
              rangeMs={rangeMs}
              yUnit="kPa"
              yScale={10}
              yDecimals={2}
            />
          </div>

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
                  basemap={basemap}
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
            />
            <div className="glass-card image-section">
              <h3 className="label">Viimeisin kuva</h3>
              <LatestImage />
            </div>
          </div>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
