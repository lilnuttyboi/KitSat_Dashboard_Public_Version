// ============================================================================
//  KitSat public dashboard — STANDALONE load test
//  No dependencies. No npm install. Run from ANY folder with just Node 18+.
//
//  Simulates N concurrent viewers polling Supabase exactly like the new
//  polling dashboard. Read-only (anon key). Proves it holds at scale: polling
//  uses ZERO Realtime, so the Free-plan caps (200 conns / 100 msg-s) never apply.
//
//  RUN (from anywhere):
//    node kitsat_loadtest.mjs            # 200 viewers
//    node kitsat_loadtest.mjs 500        # 500 viewers
//    node kitsat_loadtest.mjs 1000 8     # 1000 viewers, 8 cycles
// ============================================================================

// ── config (anon key is public + read-only by design) ───────────────────────
const URL  = 'https://fyqehnpjprbcuinmumud.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cWVobnBqcHJiY3Vpbm11bXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzE3ODEsImV4cCI6MjA5NTg0Nzc4MX0.zuP6Ck6jIhxdxx6rgG5u4p4LGeYHKxcce4yI1fru3Mg';
const TABLE   = 'telemetry';
const COLUMNS = 'created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa';

// CLI:  node kitsat_loadtest.mjs [viewers] [cycles]
const VIEWERS     = Number(process.argv[2]) || 200;
const ROUNDS      = Number(process.argv[3]) || 5;
const INTERVAL_MS = 3000;   // real frontend polls every 3 s

const REST    = `${URL}/rest/v1/${TABLE}`;
const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}` };

if (typeof fetch !== 'function') {
  console.error('Need Node 18+ (built-in fetch). Check: node -v');
  process.exit(1);
}

// one REST query; returns { data, error }
async function q(params) {
  try {
    const r = await fetch(`${REST}?${params}`, { headers: HEADERS });
    if (!r.ok) return { data: null, error: `HTTP ${r.status}` };
    return { data: await r.json(), error: null };
  } catch (e) {
    return { data: null, error: String(e) };
  }
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

console.log(`\n=== KitSat load test — ${VIEWERS} viewers, ${ROUNDS} cycles ===\n`);

// pick the current flight + a cursor a bit in the past (so polls return rows)
const latest = await q(`select=flight_id&flight_id=not.is.null&order=created_at.desc&limit=1`);
if (latest.error || !latest.data?.length) {
  console.error('Cannot reach Supabase / no data:', latest.error || 'empty');
  process.exit(1);
}
const flightId = latest.data[0].flight_id;
const newest = await q(`select=created_at&flight_id=eq.${flightId}&order=created_at.desc&limit=1`);
const cursorIso = new Date(new Date(newest.data[0].created_at).getTime() - 8000).toISOString();
const cursor = encodeURIComponent(cursorIso);
console.log(`Target flight_id=${flightId}\n`);

// ── A) initial-load cost (one viewer paginates the whole flight on open) ─────
{
  const t0 = Date.now();
  let rows = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await q(`select=${COLUMNS}&flight_id=eq.${flightId}&order=created_at.asc&limit=1000&offset=${from}`);
    if (!data || data.length === 0) break;
    rows += data.length;
    if (data.length < 1000) break;
  }
  console.log(`[A] Initial load: ${rows} rows in ${Date.now() - t0} ms  (per viewer, once)`);
}

// ── B) sustained poll load: N viewers × ROUNDS cycles ───────────────────────
const lat = [];
let errors = 0, reqs = 0;

async function onePoll() {
  const t0 = Date.now();
  const r1 = await q(`select=flight_id&flight_id=not.is.null&order=created_at.desc&limit=1`);
  const r2 = await q(`select=${COLUMNS}&flight_id=eq.${flightId}&created_at=gt.${cursor}&order=created_at.asc&limit=2000`);
  lat.push(Date.now() - t0);
  reqs += 2;
  if (r1.error || r2.error) errors++;
}

console.log(`[B] Sustained poll load (worst case: all ${VIEWERS} fire at once each cycle)…`);
const wall0 = Date.now();
for (let round = 1; round <= ROUNDS; round++) {
  const rt0 = Date.now();
  await Promise.all(Array.from({ length: VIEWERS }, onePoll));
  const rdt = Date.now() - rt0;
  console.log(`  cycle ${round}/${ROUNDS}: ${VIEWERS} viewers served in ${rdt} ms · errors=${errors}`);
  const wait = INTERVAL_MS - rdt;
  if (round < ROUNDS && wait > 0) await new Promise((r) => setTimeout(r, wait));
}
const wall = (Date.now() - wall0) / 1000;

console.log(`\n──────────── RESULT ────────────`);
console.log(`viewers:        ${VIEWERS}`);
console.log(`total requests: ${reqs}  (~${(reqs / wall).toFixed(0)}/s)`);
console.log(`errors:         ${errors}  ${errors === 0 ? '✅ PASS — no crash, no refused connections' : '❌ FAIL'}`);
console.log(`latency p50:    ${pct(lat, 50)} ms`);
console.log(`latency p95:    ${pct(lat, 95)} ms`);
console.log(`latency max:    ${Math.max(...lat)} ms`);
console.log(`────────────────────────────────`);
console.log(`Note: worst-case latency (all viewers synced). Real viewers poll on`);
console.log(`independent 3 s timers → ~${Math.round(VIEWERS / 3)} req/s steady → faster.`);
console.log(`Polling uses 0 Realtime connections → Free caps never apply.\n`);
