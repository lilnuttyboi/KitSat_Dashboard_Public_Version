import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

const DEV = import.meta.env.DEV;
const STALE_THRESHOLD_MS = 10_000;
const FRESHNESS_CHECK_INTERVAL_MS = 2_000;
const HISTORY_BUFFER = 200000; // turvaraja live-puskurille; riittää koko ~4 h lennolle
const FETCH_PAGE_SIZE = 1000;
const INITIAL_LOAD_RETRIES = 3;          // alkulatauksen uudelleenyritykset ennen virhetilaa
const INITIAL_LOAD_RETRY_BASE_MS = 1500; // viive kasvaa lineaarisesti: 1.5 s, 3 s, 4.5 s
// Alkulataus hakee vain UI:n käyttämät sarakkeet — taulussa on lisäksi mm.
// IMU- ja virtadataa, joiden siirtäminen tuhansilla riveillä olisi turhaa.
const TELEMETRY_COLUMNS =
  'created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa';

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

const isBadRow = (d) =>
  d.temp_c === 0 && d.pressure_hpa === 1013.25 && d.gps_fix === false;

// GPS raportoi joskus epäuskottavia nopeuspiikkejä (esim. 7660 m/s) myös fixin
// ollessa true. Hylätään yli uskottavan rajan menevät arvot (-> null), jotta ne
// eivät vääristä maksimia eivätkä kaavion skaalaa.
const MAX_PLAUSIBLE_SPEED = 300; // m/s
const cleanSpeed = (v) =>
  typeof v === 'number' && !Number.isNaN(v) && v >= 0 && v <= MAX_PLAUSIBLE_SPEED ? v : null;

// GPS raportoi välillä rikkinäisiä koordinaatteja fixin silti ollessa true:
// usein yksi komponentti putoaa nollan tienoille (esim. lat=0, lon=21.79),
// jolloin karttaan piirtyy viiva "Null Islandiin" Afrikan rannikolle. Pallo ei
// kuitenkaan voi hypätä satoja kilometrejä peräkkäisten näytteiden välillä, joten
// hylätään koordinaatti (gps_fix -> false) jos se on mahdoton tai liian kaukana
// edellisestä kelvollisesta sijainnista. Ei sidottu kovakoodattuun alueeseen.
const MAX_JUMP_KM = 150;

const distanceKm = (aLat, aLon, bLat, bLon) => {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Palauttaa rivin, jonka gps_fix on false jos sijainti ei ole uskottava.
// last on mutatoitava { value: {lat, lon, ms} | null } -säiliö, joka kantaa
// viimeisen kelvollisen sijainnin (ja sen ajan) sekä alkulatauksen että
// realtime-päivitysten yli.
// Sallittu hyppy skaalautuu kuluneen ajan mukaan: lyhyellä välillä vain pieni
// hyppy (nappaa GPS-glitchit), pitkän datakatkon jälkeen iso hyppy sallitaan
// (pallo on ehtinyt liikkua oikeasti), jottei jälki jää jumiin katkon jälkeen.
const withCleanFix = (row, last) => {
  if (!row.gps_fix) return row;
  const lat = row.gps_lat, lon = row.gps_lon;
  const inRange =
    typeof lat === 'number' && typeof lon === 'number' &&
    !Number.isNaN(lat) && !Number.isNaN(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    lat !== 0 && lon !== 0; // nolla = GPS:n "ei dataa" -sentinel, ei koskaan oikea sijainti täällä
  if (!inRange) return { ...row, gps_fix: false };
  const ms = new Date(row.created_at).getTime();
  if (last.value) {
    // Aika edellisestä kelvollisesta näytteestä; vähintään 1 s, ettei sama
    // aikaleima tai viallinen aika kutista rajaa nollaan.
    const elapsedS = Number.isFinite(ms) ? Math.max(1, (ms - last.value.ms) / 1000) : 1;
    const maxJumpKm = Math.max(MAX_JUMP_KM, (elapsedS * MAX_PLAUSIBLE_SPEED) / 1000);
    if (distanceKm(last.value.lat, last.value.lon, lat, lon) > maxJumpKm) {
      return { ...row, gps_fix: false };
    }
  }
  last.value = { lat, lon, ms };
  return row;
};

const observeMax = (prev, v) => {
  if (v == null || Number.isNaN(v)) return prev;
  return prev == null || v > prev ? v : prev;
};

const observeMin = (prev, v) => {
  if (v == null || Number.isNaN(v)) return prev;
  return prev == null || v < prev ? v : prev;
};

export const useTelemetry = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // alkulataus epäonnistui (erotettu "ei dataa" -tilasta)
  const [status, setStatus] = useState('offline');
  const [maxAlt, setMaxAlt] = useState(null);
  const [minTemp, setMinTemp] = useState(null);
  const [maxSpeed, setMaxSpeed] = useState(null);
  const [flightStartMs, setFlightStartMs] = useState(() => Date.now());
  const [lastDataMs, setLastDataMs] = useState(null);

  const lastReceivedAtRef = useRef(0); // selainaika: viimeisin rivin SAAPUMISHetki
  const channelSubscribedRef = useRef(false);
  const currentFlightIdRef = useRef(null);
  const lastGoodCoordRef = useRef({ value: null }); // viimeisin uskottava sijainti

  const tableName = import.meta.env.VITE_SUPABASE_TABLE;

  const markFresh = useCallback((createdAt) => {
    const t = createdAt ? new Date(createdAt).getTime() : Date.now();
    lastReceivedAtRef.current = Date.now();
    setLastDataMs(t);
    setError(false); // tuoretta dataa saapui -> mahdollinen virhetila ohi
    if (channelSubscribedRef.current) setStatus('online');
  }, []);

  const updateData = useCallback((newData) => {
    if (isBadRow(newData)) return;
    newData = { ...newData, gps_speed: cleanSpeed(newData.gps_speed) };

    const curId = currentFlightIdRef.current;
    const newId = newData.flight_id;

    // Seurataan aina tuoreimman datan flight_id:tä, ei suurinta numeroa:
    // realtime-INSERT on määritelmän mukaan tuorein rivi, joten mikä tahansa
    // poikkeava flight_id (myös pienempi) tarkoittaa uutta lentoa.
    if (curId != null && newId !== curId) {
      lastGoodCoordRef.current.value = null; // uusi lento: sijainnin vertailu alusta
      newData = withCleanFix(newData, lastGoodCoordRef.current);
      currentFlightIdRef.current = newId;
      setFlightStartMs(new Date(newData.created_at).getTime());
      setTelemetry(newData);
      setHistory([toHistoryEntry(newData)]);
      setMaxAlt(observeMax(null, newData.gps_alt));
      setMinTemp(observeMin(null, newData.temp_c));
      setMaxSpeed(observeMax(null, newData.gps_speed));
      markFresh(newData.created_at);
      supabase
        .from(tableName)
        .select('created_at')
        .eq('flight_id', newId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
        .then(({ data: first }) => {
          if (first?.created_at && currentFlightIdRef.current === newId) {
            setFlightStartMs(new Date(first.created_at).getTime());
          }
        });
      return;
    }

    if (curId == null) {
      currentFlightIdRef.current = newId;
      setFlightStartMs(new Date(newData.created_at).getTime());
    }

    newData = withCleanFix(newData, lastGoodCoordRef.current);

    setTelemetry((prev) => {
      if (prev?.created_at === newData.created_at) return prev;
      return newData;
    });
    setHistory((prev) => {
      const entry = toHistoryEntry(newData);
      if (prev.length && prev[prev.length - 1].rawTimeMs === entry.rawTimeMs) return prev;
      return [...prev, entry].slice(-HISTORY_BUFFER);
    });
    setMaxAlt((prev) => observeMax(prev, newData.gps_alt));
    setMinTemp((prev) => observeMin(prev, newData.temp_c));
    setMaxSpeed((prev) => observeMax(prev, newData.gps_speed));
    markFresh(newData.created_at);
  }, [markFresh, tableName]);

  useEffect(() => {
    // Palauttaa 'ok' (dataa ladattu) | 'empty' (ei lentoa/dataa) | 'error' (haku
    // epäonnistui). Ei aseta loading/error-tilaa itse — sen tekee retry-kääre.
    const fetchInitialData = async () => {
      try {
        // Valitaan lento tuoreimman datan mukaan, ei suurimman flight_id:n —
        // numerointi ei ole aina kronologinen (vanha testiajo voi saada
        // isomman numeron kuin parhaillaan live-lento).
        const { data: latest, error: latestErr } = await supabase
          .from(tableName)
          .select('flight_id')
          .not('flight_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestErr) {
          console.error('Latest flight lookup error:', latestErr.message);
          return 'error';
        }

        const flightId = latest?.flight_id;
        if (flightId == null) return 'empty';

        const data = [];
        let pageError = null;
        for (let from = 0; ; from += FETCH_PAGE_SIZE) {
          const { data: page, error: pageErr } = await supabase
            .from(tableName)
            .select(TELEMETRY_COLUMNS)
            .eq('flight_id', flightId)
            .order('created_at', { ascending: true })
            .range(from, from + FETCH_PAGE_SIZE - 1);
          if (pageErr) { pageError = pageErr; break; }
          if (!page || page.length === 0) break;
          data.push(...page);
          if (page.length < FETCH_PAGE_SIZE) break;
        }

        if (pageError) {
          console.error('Supabase fetch error:', pageError.message);
          return 'error';
        }
        if (data.length === 0) return 'empty';

        currentFlightIdRef.current = flightId;
        setFlightStartMs(new Date(data[0].created_at).getTime());
        // Käydään rivit aikajärjestyksessä: withCleanFix mutatoi last-säiliötä,
        // joten sijainnin vertailu jatkuu saumatta realtime-päivityksiin.
        const last = lastGoodCoordRef.current;
        last.value = null;
        const clean = data
          .filter((d) => !isBadRow(d))
          .map((d) => withCleanFix({ ...d, gps_speed: cleanSpeed(d.gps_speed) }, last));
        if (clean.length === 0) return 'empty';
        const newest = clean[clean.length - 1];
        setTelemetry(newest);
        setHistory(clean.map(toHistoryEntry));
        setMaxAlt(clean.reduce((m, d) => observeMax(m, d.gps_alt), null));
        setMinTemp(clean.reduce((m, d) => observeMin(m, d.temp_c), null));
        setMaxSpeed(clean.reduce((m, d) => observeMax(m, d.gps_speed), null));
        const newestMs = new Date(newest.created_at).getTime();
        lastReceivedAtRef.current = Date.now();
        setLastDataMs(newestMs);
        return 'ok';
      } catch (err) {
        console.error('Catch error:', err);
        return 'error';
      }
    };

    // Tilataan realtime heti (ei jää aukkoa), mutta puskuroidaan rivit kunnes
    // alkulataus on valmis — muuten lataus voisi ylikirjoittaa kesken tulleen rivin.
    let cancelled = false;
    let initialLoaded = false;
    const pending = [];

    // Yritetään alkulatausta muutaman kerran ennen virhetilan näyttämistä, jotta
    // hetkellinen verkkokatko sivun avautuessa ei jätä koontinäyttöä tyhjäksi.
    (async () => {
      let result = 'error';
      for (let attempt = 0; attempt <= INITIAL_LOAD_RETRIES; attempt++) {
        if (cancelled) return;
        result = await fetchInitialData();
        if (result !== 'error') break;
        if (attempt < INITIAL_LOAD_RETRIES) {
          await new Promise((r) => setTimeout(r, INITIAL_LOAD_RETRY_BASE_MS * (attempt + 1)));
        }
      }
      if (cancelled) return;
      setError(result === 'error');
      setLoading(false);
      initialLoaded = true;
      for (const row of pending) updateData(row);
      pending.length = 0;
    })();

    // Käytetään Realtime Broadcastia (kanta lähettää INSERTit tietokantatriggerillä)
    // postgres_changes-tilauksen sijaan: kannan kuorma ei kasva katsojamäärän
    // mukaan, koska Realtime-palvelin monistaa yhden viestin kaikille tilaajille.
    // Kanavan nimen ('telemetry') ja eventin ('telemetry_insert') on täsmättävä
    // tietokannan triggerin realtime.send(...)-kutsuun, tai rivit eivät tule perille.
    const channel = supabase
      .channel('telemetry')
      .on('broadcast', { event: 'telemetry_insert' }, (msg) => {
        if (DEV) console.log('Realtime update received');
        const row = msg.payload; // triggerin jsonb_build_object(...) -hyötykuorma
        if (!row) return;
        if (!initialLoaded) pending.push(row);
        else updateData(row);
      })
      .subscribe((s) => {
        if (DEV) console.log('Realtime status:', s);
        if (s === 'SUBSCRIBED') {
          channelSubscribedRef.current = true;
        } else {
          channelSubscribedRef.current = false;
          setStatus('offline');
        }
      });

    const freshnessTimer = setInterval(() => {
      const fresh = Date.now() - lastReceivedAtRef.current < STALE_THRESHOLD_MS;
      if (channelSubscribedRef.current && fresh) setStatus('online');
      else setStatus('offline');
    }, FRESHNESS_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      clearInterval(freshnessTimer);
    };
  }, [tableName, updateData]);

  return { telemetry, history, loading, error, status, maxAlt, minTemp, maxSpeed, flightStartMs, lastDataMs };
};
