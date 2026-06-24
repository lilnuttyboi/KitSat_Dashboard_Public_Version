// ============================================================================
//  KitSat public dashboard — load test
//  Simulates N concurrent "viewers" polling Supabase exactly like the new
//  useTelemetry.js polling path. Proves the REST/polling approach holds at
//  scale (it uses ZERO Realtime, so the Free-plan 200-conn / 100 msg-s caps
//  never apply). Read-only — anon key only, never writes.
//
//  RUN:
//    node loadtest.mjs            # 200 viewers (default)
//    node loadtest.mjs 500        # 500 viewers
//    node loadtest.mjs 1000 8     # 1000 viewers, 8 poll cycles
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { performance } from 'node:perf_hooks';

// ── config (anon key is public + read-only by design) ───────────────────────
const URL  = 'https://fyqehnpjprbcuinmumud.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cWVobnBqcHJiY3Vpbm11bXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzE3ODEsImV4cCI6MjA5NTg0Nzc4MX0.zuP6Ck6jIhxdxx6rgG5u4p4LGeYHKxcce4yI1fru3Mg';
const TABLE   = 'telemetry';
const COLUMNS = 'created_at,flight_id,gps_lat,gps_lon,gps_alt,gps_speed,gps_fix,temp_c,pressure_hpa';

// CLI args:  node loadtest.mjs [viewers] [cycles]
const VIEWERS     = Number(process.argv[2]) || 200;
const ROUNDS      = Number(process.argv[3]) || 5;
const INTERVAL_MS = 3000;   // real frontend polls every 3 s

const sb = createClient(URL, ANON, { auth: { persistSession: false } });

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

console.log(`\n=== KitSat load test — ${VIEWERS} viewers, ${ROUNDS} cycles ===\n`);

// pick the current flight + a cursor a bit in the past (so polls return rows)
const { data: latest, error: latErr } = await sb.from(TABLE).select('flight_id')
  .not('flight_id', 'is', null).order('created_at', { ascending: false })
  .limit(1).maybeSingle();
if (latErr) { console.error('Cannot reach Supabase:', latErr.message); process.exit(1); }
const flightId = latest.flight_id;
const { data: newest } = await sb.from(TABLE).select('created_at')
  .eq('flight_id', flightId).order('created_at', { ascending: false })
  .limit(1).maybeSingle();
const cursor = new Date(new Date(newest.created_at).getTime() - 8000).toISOString();
console.log(`Target flight_id=${flightId}\n`);

// ── A) initial-load cost (one viewer paginates the whole flight on open) ─────
{
  const t0 = performance.now();
  let rows = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from(TABLE).select(COLUMNS)
      .eq('flight_id', flightId).order('created_at', { ascending: true })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows += data.length;
    if (data.length < 1000) break;
  }
  console.log(`[A] Initial load: ${rows} rows in ${(performance.now() - t0).toFixed(0)} ms  (per viewer, once)`);
}

// ── B) sustained poll load: N viewers × ROUNDS cycles ───────────────────────
const lat = [];
let errors = 0, reqs = 0;

async function onePoll() {
  const t0 = performance.now();
  const r1 = await sb.from(TABLE).select('flight_id')
    .not('flight_id', 'is', null).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  const r2 = await sb.from(TABLE).select(COLUMNS)
    .eq('flight_id', flightId).gt('created_at', cursor)
    .order('created_at', { ascending: true }).limit(2000);
  lat.push(performance.now() - t0);
  reqs += 2;
  if (r1.error || r2.error) errors++;
}

console.log(`\n[B] Sustained poll load (worst case: all ${VIEWERS} fire at once each cycle)…`);
const wall0 = performance.now();
for (let round = 1; round <= ROUNDS; round++) {
  const rt0 = performance.now();
  await Promise.all(Array.from({ length: VIEWERS }, onePoll));
  const rdt = performance.now() - rt0;
  console.log(`  cycle ${round}/${ROUNDS}: ${VIEWERS} viewers served in ${rdt.toFixed(0)} ms · errors=${errors}`);
  const wait = INTERVAL_MS - rdt;
  if (round < ROUNDS && wait > 0) await new Promise((r) => setTimeout(r, wait));
}
const wall = (performance.now() - wall0) / 1000;

console.log(`\n──────────── RESULT ────────────`);
console.log(`viewers:        ${VIEWERS}`);
console.log(`total requests: ${reqs}  (~${(reqs / wall).toFixed(0)}/s)`);
console.log(`errors:         ${errors}  ${errors === 0 ? '✅ PASS — no crash, no refused connections' : '❌ FAIL'}`);
console.log(`latency p50:    ${pct(lat, 50).toFixed(0)} ms`);
console.log(`latency p95:    ${pct(lat, 95).toFixed(0)} ms`);
console.log(`latency max:    ${Math.max(...lat).toFixed(0)} ms`);
console.log(`────────────────────────────────`);
console.log(`Reminder: latency here is the WORST case (all viewers synced). Real`);
console.log(`viewers poll on independent 3 s timers → ~${(VIEWERS / 3).toFixed(0)} req/s steady → faster.`);
console.log(`Polling uses 0 Realtime connections, so the Free caps never apply.\n`);
