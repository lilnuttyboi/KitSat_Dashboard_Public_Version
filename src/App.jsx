import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { useTelemetry } from './hooks/useTelemetry';
import LatestImage from './components/LatestImage';
import FlightTimer from './components/FlightTimer';
import MaintenanceOverlay from './components/MaintenanceOverlay';
import { createControlChannel, readPersistedState, writePersistedState } from './lib/controlChannel';
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
  const [controlConnected, setControlConnected] = useState(false); // onko ohjausikkuna kytketty

  // ── Ohjauskanava: erillinen #ohjaus-ikkuna ohjaa tätä koontinäyttöä ──────
  // Koontinäyttö on tilan ainoa lähde: se soveltaa komennot ja lähettää
  // tuoreimman tilan takaisin (nappien korostuksia varten).
  const channelRef = useRef(null);
  const stateRef = useRef(null);
  if (stateRef.current === null) {
    stateRef.current = { mapMode, basemap, cameraMode, maintenance, theme, range: rangeMs };
  }
  // Pidä viimeisin teemansetteri refissä, jottei mount-efektin (kanava) tarvitse
  // riippua siitä — useTheme luo sen joka renderillä. Päivitys efektissä eikä
  // renderissä (react-hooks/refs: refiä ei kirjoiteta renderin aikana).
  const setThemeChoiceRef = useRef(setThemeChoice);
  useEffect(() => {
    setThemeChoiceRef.current = setThemeChoice;
  });

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
          case 'setTheme': setThemeChoiceRef.current(msg.value === 'light' ? 'light' : 'dark'); break;
          // Hyväksy vain kelvollinen aikaväli: null (MAX) tai äärellinen luku (ms).
          case 'setRange': if (msg.value === null || Number.isFinite(msg.value)) setRangeMs(msg.value); break;
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
  // HUOM: snapshotin `theme` on vain PEILI ohjausikkunan korostusta varten;
  // teeman varsinainen lähde on useTheme + localStorage('theme') (säilyttää
  // käyttöjärjestelmäseurannan). Älä siemennä koontinäytön teemaa tästä tilasta.
  useEffect(() => {
    const snapshot = { mapMode, basemap, cameraMode, maintenance, theme, range: rangeMs };
    stateRef.current = snapshot;
    writePersistedState(snapshot);
    channelRef.current?.post({ type: 'state', state: snapshot });
  }, [mapMode, basemap, cameraMode, maintenance, theme, rangeMs]);
  const route = useMemo(() => buildRoute(history), [history]);
  const route3d = useMemo(() => buildRoute3d(history), [history]);

  // Avaa erillinen ohjausikkuna (#ohjaus). Sama toiminto yläpalkin ja
  // huoltoruudun ratasnapeille.
  const openControl = () =>
    window.open(
      `${window.location.origin}${window.location.pathname}#ohjaus`,
      'kitsat-ohjaus',
      'width=420,height=720'
    );

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
          {!controlConnected && !maintenance && (
            <button
              className="open-control-btn"
              onClick={openControl}
              aria-label="Avaa ohjaus erilliseen ikkunaan"
              title="Avaa ohjaus erilliseen ikkunaan"
            >
              ⚙
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
    {/* Ratasnappi huoltoruudun PÄÄLLE: ainoa tapa avata ohjaus takaisin, kun
        huoltotila peittää yläpalkin ratasnapin. Näkyy vain kun ohjaus ei ole auki. */}
    {maintenance && !controlConnected && (
      <button
        className="maintenance-launcher"
        onClick={openControl}
        aria-label="Avaa ohjaus erilliseen ikkunaan"
        title="Avaa ohjaus erilliseen ikkunaan"
      >
        ⚙
      </button>
    )}
    </>
  );
}

export default App;
