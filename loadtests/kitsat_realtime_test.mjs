// ============================================================================
//  KitSat dashboard — REALTIME BROADCAST load test  (the one that matches prod)
//
//  Opens N independent Supabase Realtime subscribers (= N browser tabs) to the
//  SAME path the live dashboard uses:  channel 'telemetry', event
//  'telemetry_insert'  (see src/hooks/useTelemetry.js + docs/broadcast-migration.sql).
//
//  Measures the ACTUAL binding constraint for your viewer count:
//    1) concurrent Realtime CONNECTIONS accepted  -> your real ceiling
//    2) broadcast FAN-OUT: does one insert reach ALL connected viewers?
//
//  Why this test is valid from one machine (the REST poll test was not):
//  the Realtime connection cap is PROJECT-WIDE, not per-IP. N sockets from this
//  box count against the limit exactly like N browsers on N IPs would.
//
//  RUN (from the project root, so node finds node_modules):
//    node kitsat_realtime_test.mjs            # 100 viewers, hold 60 s
//    node kitsat_realtime_test.mjs 300        # 300 viewers
//    node kitsat_realtime_test.mjs 500 90     # 500 viewers, hold 90 s
//
//  ⚠  Connections count against the project's GLOBAL Realtime cap. If real
//     viewers are watching a LIVE flight, this competes with them — run
//     off-flight, or knowingly. For >250 viewers raise the socket limit first:
//        ulimit -n 4096
//     To see fan-out, insert a telemetry row (Supabase SQL editor) while it
//     holds, or run it during a real flight.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// anon key is public + read-only by design (same as the dashboard ships)
const URL  = 'https://fyqehnpjprbcuinmumud.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cWVobnBqcHJiY3Vpbm11bXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzE3ODEsImV4cCI6MjA5NTg0Nzc4MX0.zuP6Ck6jIhxdxx6rgG5u4p4LGeYHKxcce4yI1fru3Mg';

const VIEWERS = Number(process.argv[2]) || 100;
const HOLD_S  = Number(process.argv[3]) || 60;
const RAMP_MS = 20; // avataan tilaajat porrastetusti, ei yhtenä ryntäyksenä (estää join-ryöpyn throttlauksen)

if (typeof WebSocket !== 'function') {
  console.error('Tarvitaan Node 21+ (sisäänrakennettu global WebSocket). node -v:', process.version);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

console.log(`\n=== KitSat REALTIME broadcast test — ${VIEWERS} viewers, hold ${HOLD_S}s ===`);
console.log(`channel='telemetry'  event='telemetry_insert'  (täsmää live-dashboardiin)\n`);

const viewers = [];
const subLatencies = [];
let subscribed = 0, failed = 0;
const failReasons = {};
let totalMsgs = 0;
const viewersWithMsg = new Set();
const deliveryLatencies = [];

function makeViewer(i) {
  return new Promise((resolve) => {
    const client = createClient(URL, ANON);
    const t0 = Date.now();
    let settled = false;

    const channel = client
      .channel('telemetry')
      .on('broadcast', { event: 'telemetry_insert' }, (msg) => {
        totalMsgs++;
        viewersWithMsg.add(i);
        const createdAt = msg?.payload?.created_at;
        if (createdAt) {
          const lat = Date.now() - new Date(createdAt).getTime();
          if (lat >= 0 && lat < 600000) deliveryLatencies.push(lat);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (!settled) { settled = true; subscribed++; subLatencies.push(Date.now() - t0); resolve(); }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!settled) { settled = true; failed++; failReasons[status] = (failReasons[status] || 0) + 1; resolve(); }
        }
      });

    viewers.push({ client, channel });

    // varmistin: jos mikään status ei koskaan saavu, älä jää roikkumaan
    setTimeout(() => {
      if (!settled) { settled = true; failed++; failReasons['NO_STATUS'] = (failReasons['NO_STATUS'] || 0) + 1; resolve(); }
    }, 30000);
  });
}

// ── Vaihe 1: avaa tilaajat porrastetusti ────────────────────────────────────
const wall0 = Date.now();
const opening = [];
for (let i = 0; i < VIEWERS; i++) {
  opening.push(makeViewer(i));
  await sleep(RAMP_MS);
  if ((i + 1) % 50 === 0) console.log(`  opened ${i + 1}/${VIEWERS} … subscribed=${subscribed} failed=${failed}`);
}
await Promise.all(opening);
console.log(`\n[1] Connect phase done in ${((Date.now() - wall0) / 1000).toFixed(1)}s`);
console.log(`    subscribed=${subscribed}/${VIEWERS}  failed=${failed}  ${JSON.stringify(failReasons)}`);
console.log(`    subscribe latency p50=${pct(subLatencies, 50)}ms p95=${pct(subLatencies, 95)}ms max=${Math.max(0, ...subLatencies)}ms`);

// ── Vaihe 2: pidä yhteydet auki ja kuuntele broadcasteja ────────────────────
console.log(`\n[2] Holding ${subscribed} connections open ${HOLD_S}s, listening for telemetry_insert…`);
console.log(`    (lisää rivi Supabaseen tai aja live-lennon aikana nähdäksesi fan-outin)`);
for (let s = 0; s < HOLD_S; s += 5) {
  await sleep(Math.min(5000, HOLD_S * 1000 - s * 1000));
  console.log(`    t+${Math.min(s + 5, HOLD_S)}s: msgs=${totalMsgs} viewers-with-msg=${viewersWithMsg.size}/${subscribed}`);
}

// ── Tulokset ────────────────────────────────────────────────────────────────
console.log(`\n──────────── RESULT ────────────`);
console.log(`requested viewers:      ${VIEWERS}`);
console.log(`connected (SUBSCRIBED): ${subscribed}   ${subscribed === VIEWERS ? '✅ all accepted' : '⚠️  not all accepted'}`);
console.log(`failed to connect:      ${failed}  ${JSON.stringify(failReasons)}`);
console.log(`subscribe p50/p95/max:  ${pct(subLatencies, 50)} / ${pct(subLatencies, 95)} / ${Math.max(0, ...subLatencies)} ms`);
console.log(`broadcasts received:    ${totalMsgs}  across ${viewersWithMsg.size}/${subscribed} connected viewers`);
if (deliveryLatencies.length)
  console.log(`delivery latency p50/p95/max: ${pct(deliveryLatencies, 50)} / ${pct(deliveryLatencies, 95)} / ${Math.max(...deliveryLatencies)} ms (now − row created_at)`);
else
  console.log(`delivery latency:       n/a (ei broadcasteja — ei live-lentoa / ei insertiä / triggeri ei käytössä)`);
console.log(`────────────────────────────────`);
console.log(`Tulkinta:`);
console.log(` • 'connected' = montako yhtäaikaista katsojaa Realtime hyväksyi. TÄMÄ on kattosi.`);
console.log(` • failed>0 (CHANNEL_ERROR/TIMED_OUT) jonkin rajan kohdalla → osuit plan-tason`);
console.log(`   yhtäaikaisten yhteyksien kattoon (Free ~200). Se on skaalauksen ratkaiseva luku.`);
console.log(` • 'received across X/Y viewers' testaa fan-outin: yhden insertin pitäisi tavoittaa`);
console.log(`   KAIKKI yhdistetyt katsojat. X<Y = vajaa fan-out tai pudonneita viestejä.`);
console.log(` • Realtime-katto on PROJEKTIN LAAJUINEN → tämä yhden koneen testi on pätevä.\n`);

// siivous
for (const v of viewers) { try { await v.client.removeChannel(v.channel); } catch { /* ignore */ } }
process.exit(0);
