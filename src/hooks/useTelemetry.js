import { useState, useEffect, useRef } from 'react';

const DEV = import.meta.env.DEV;
const STALE_THRESHOLD_MS = 10_000;
const FRESHNESS_CHECK_INTERVAL_MS = 2_000;
const HISTORY_BUFFER = 200000; // turvaraja live-puskurille; riittää koko ~4 h lennolle
const HISTORY_URL = '/api/history';
const LATEST_URL = '/api/latest';
const POLL_INTERVAL_MS = 4_000;            // live-tailin pollausväli
const INITIAL_LOAD_RETRIES = 3;            // alkulatauksen uudelleenyritykset
const INITIAL_LOAD_RETRY_BASE_MS = 1500;   // viive kasvaa: 1.5 s, 3 s, 4.5 s

const toHistoryEntry = (d) => {
  const t = new Date(d.created_at);
  return {
    time: t.toLocaleTimeString(),
    rawTimeMs: t.getTime(),
    alt: d.gps_alt ?? null,
    temp: d.temp_c ?? null,
    pressure: d.pressure_hpa ?? null,
    speed: d.gps_speed ?? null,
    lat: d.gps_lat,
    lon: d.gps_lon,
    fix: d.gps_fix ?? false,
  };
};

const observeMax = (prev, v) => {
  if (v == null || Number.isNaN(v)) return prev;
  return prev == null || v > prev ? v : prev;
};
const observeMin = (prev, v) => {
  if (v == null || Number.isNaN(v)) return prev;
  return prev == null || v < prev ? v : prev;
};

// Data tulee nyt valmiiksi siivottuna palvelimelta (Pages Functions): tämä hook
// vain hakee /api/history kerran ja pollaa /api/latest:ia. Supabasen kuorma ei
// kasva katsojamäärän mukaan, koska Cloudflaren reunavälimuisti koalesoi pyynnöt.
export const useTelemetry = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // alkulataus epäonnistui (erotettu "ei dataa":sta)
  const [status, setStatus] = useState('offline');
  const [maxAlt, setMaxAlt] = useState(null);
  const [minTemp, setMinTemp] = useState(null);
  const [maxSpeed, setMaxSpeed] = useState(null);
  const [flightStartMs, setFlightStartMs] = useState(() => Date.now());
  const [lastDataMs, setLastDataMs] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);

  const lastReceivedAtRef = useRef(0);       // selainaika: viimeisin datan saapuminen
  const currentFlightIdRef = useRef(null);
  const newestMsRef = useRef(-Infinity);     // uusimman sulautetun rivin aikaleima (dedup)

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let reloading = false;

    const markFresh = (createdAt) => {
      const t = createdAt ? new Date(createdAt).getTime() : Date.now();
      lastReceivedAtRef.current = Date.now();
      setLastDataMs(t);
      setError(false);
      setStatus('online');
    };

    const fetchSnapshot = async (url) => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return res.json();
    };

    // Korvaa koko näkymän /api/history-snapshotilla (alkulataus + uusi lento).
    const applyHistory = (snap) => {
      const rows = snap.rows ?? [];
      currentFlightIdRef.current = snap.flightId ?? null;
      if (snap.startMs) setFlightStartMs(snap.startMs);
      setTelemetry(rows.length ? rows[rows.length - 1] : null);
      setHistory(rows.map(toHistoryEntry));
      setMaxAlt(rows.reduce((m, d) => observeMax(m, d.gps_alt), null));
      setMinTemp(rows.reduce((m, d) => observeMin(m, d.temp_c), null));
      setMaxSpeed(rows.reduce((m, d) => observeMax(m, d.gps_speed), null));
      const newestMs = rows.length ? new Date(rows[rows.length - 1].created_at).getTime() : -Infinity;
      newestMsRef.current = newestMs;
      if (rows.length) {
        lastReceivedAtRef.current = Date.now();
        setLastDataMs(newestMs);
      }
    };

    const reloadHistory = async () => {
      if (reloading) return;
      reloading = true;
      try {
        const snap = await fetchSnapshot(HISTORY_URL);
        if (!cancelled) applyHistory(snap);
      } catch (err) {
        if (DEV) console.error('History reload error:', err);
      } finally {
        reloading = false;
      }
    };

    // Sulauttaa yhden (jo siivotun) live-rivin. Uusi flight_id -> koko historia uusiksi.
    const applyRow = (row) => {
      if (!row) return;
      const curId = currentFlightIdRef.current;
      const newId = row.flight_id;
      if (curId != null && newId !== curId) {
        currentFlightIdRef.current = newId;
        reloadHistory();
        return;
      }
      const ms = new Date(row.created_at).getTime();
      if (curId == null) {
        currentFlightIdRef.current = newId;
        setFlightStartMs(ms);
      }
      // /api/latest palauttaa aina ~60 viimeistä riviä, joista valtaosa on jo
      // historiassa. Sulautetaan VAIN aidosti uudemmat rivit (ms > uusin nähty),
      // muuten sama ikkuna liimautuisi historiaan joka pollissa -> tuplaviivat.
      if (!(ms > newestMsRef.current)) return;
      newestMsRef.current = ms;
      setTelemetry(row);
      setHistory((prev) => [...prev, toHistoryEntry(row)].slice(-HISTORY_BUFFER));
      setMaxAlt((prev) => observeMax(prev, row.gps_alt));
      setMinTemp((prev) => observeMin(prev, row.temp_c));
      setMaxSpeed((prev) => observeMax(prev, row.gps_speed));
      markFresh(row.created_at);
    };

    const pollLatest = async () => {
      if (document.hidden) return;
      try {
        const snap = await fetchSnapshot(LATEST_URL);
        if (cancelled) return;
        if (snap.imageUrl) setImageUrl(snap.imageUrl);
        for (const row of snap.rows ?? []) applyRow(row);
      } catch (err) {
        if (DEV) console.error('Latest poll error:', err);
      }
    };

    // Alkulataus muutamalla uudelleenyrityksellä, jottei hetkellinen verkkokatko
    // jätä koontinäyttöä tyhjäksi. Live-pollaus alkaa vasta tämän jälkeen.
    (async () => {
      let ok = false;
      for (let attempt = 0; attempt <= INITIAL_LOAD_RETRIES; attempt++) {
        if (cancelled) return;
        try {
          const snap = await fetchSnapshot(HISTORY_URL);
          if (cancelled) return;
          applyHistory(snap);
          ok = true;
          break;
        } catch (err) {
          if (DEV) console.error('Initial load error:', err);
          if (attempt < INITIAL_LOAD_RETRIES) {
            await new Promise((r) => setTimeout(r, INITIAL_LOAD_RETRY_BASE_MS * (attempt + 1)));
          }
        }
      }
      if (cancelled) return;
      setError(!ok);
      setLoading(false);
      pollLatest();
      pollTimer = setInterval(pollLatest, POLL_INTERVAL_MS);
    })();

    // Status johdetaan datan tuoreudesta: online jos viimeisin data < kynnys.
    const freshnessTimer = setInterval(() => {
      const fresh = Date.now() - lastReceivedAtRef.current < STALE_THRESHOLD_MS;
      setStatus(fresh ? 'online' : 'offline');
    }, FRESHNESS_CHECK_INTERVAL_MS);

    const onVisible = () => { if (!document.hidden) pollLatest(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      clearInterval(freshnessTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { telemetry, history, loading, error, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs, imageUrl };
};
