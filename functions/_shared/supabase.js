// Supabase REST + Storage -haut pelkällä fetchillä (ei @supabase/supabase-js:ää).
// Kaikki funktiot ottavat cfg:n; fetchImpl mahdollistaa mockauksen testeissä.

const restHeaders = (anonKey) => ({ apikey: anonKey, Authorization: `Bearer ${anonKey}` });

const COLUMNS =
  'created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa';
const PAGE = 1000;

// Tuorein lento valitaan uusimman created_at:n mukaan — EI suurimman flight_id:n.
export async function selectCurrentFlightId(cfg) {
  const { url, anonKey, table, fetchImpl = fetch } = cfg;
  const q = `${url}/rest/v1/${table}?select=flight_id&flight_id=not.is.null&order=created_at.desc&limit=1`;
  const r = await fetchImpl(q, { headers: restHeaders(anonKey) });
  if (!r.ok) throw new Error(`flight lookup ${r.status}`);
  const rows = await r.json();
  return rows[0]?.flight_id ?? null;
}

export async function fetchFlightHistory(cfg, flightId) {
  const { url, anonKey, table, fetchImpl = fetch } = cfg;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const q = `${url}/rest/v1/${table}?select=${COLUMNS}&flight_id=eq.${flightId}` +
      `&order=created_at.asc&limit=${PAGE}&offset=${from}`;
    const r = await fetchImpl(q, { headers: restHeaders(anonKey) });
    if (!r.ok) throw new Error(`history ${r.status}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

export async function fetchLatestRows(cfg, flightId, limit = 60) {
  const { url, anonKey, table, fetchImpl = fetch } = cfg;
  const q = `${url}/rest/v1/${table}?select=${COLUMNS}&flight_id=eq.${flightId}` +
    `&order=created_at.desc&limit=${limit}`;
  const r = await fetchImpl(q, { headers: restHeaders(anonKey) });
  if (!r.ok) throw new Error(`latest ${r.status}`);
  const rows = await r.json();
  return rows.reverse(); // desc -> asc
}

// Globaalisti uusin kuva: listaa juuren kansiot, jokaisesta tuorein tiedosto,
// vertaa created_at:t. Kansioiden nimien lajittelu ei saa valita väärää lentoa.
export async function fetchLatestImageUrl(cfg) {
  const { url, anonKey, bucket = 'camera', fetchImpl = fetch } = cfg;
  const listUrl = `${url}/storage/v1/object/list/${bucket}`;
  const headers = { ...restHeaders(anonKey), 'content-type': 'application/json' };

  const rootRes = await fetchImpl(listUrl, {
    method: 'POST', headers,
    body: JSON.stringify({ prefix: '', limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!rootRes.ok) return null;
  const entries = await rootRes.json();
  const folders = (entries ?? []).filter((e) => e.id === null); // kansioilla id === null

  let newest = null;
  for (const folder of folders) {
    const res = await fetchImpl(listUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ prefix: folder.name, limit: 1, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    if (!res.ok) continue;
    const files = await res.json();
    const file = files?.[0];
    if (!file) continue;
    const createdAt = file.created_at ?? file.updated_at ?? '';
    if (!newest || createdAt > newest.createdAt) {
      newest = { path: `${folder.name}/${file.name}`, createdAt };
    }
  }
  if (!newest) return null;
  return `${url}/storage/v1/object/public/${bucket}/${newest.path}`;
}
