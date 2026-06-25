// Integraatiosavutesti oikeaa (julkista, vain-luku) Supabasea vasten.
// Aja: node functions/_shared/functions.smoke.mjs
import assert from 'node:assert/strict';
import {
  selectCurrentFlightId, fetchFlightHistory, fetchLatestRows, fetchLatestImageUrl,
} from './supabase.js';

const cfg = {
  url: 'https://fyqehnpjprbcuinmumud.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cWVobnBqcHJiY3Vpbm11bXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzE3ODEsImV4cCI6MjA5NTg0Nzc4MX0.zuP6Ck6jIhxdxx6rgG5u4p4LGeYHKxcce4yI1fru3Mg',
  table: 'telemetry',
  bucket: 'camera',
};

const flightId = await selectCurrentFlightId(cfg);
console.log('flightId:', flightId);
assert.ok(flightId !== undefined, 'flightId should be defined (number or null)');

if (flightId != null) {
  const latest = await fetchLatestRows(cfg, flightId, 60);
  assert.ok(Array.isArray(latest), 'latest rows is array');
  if (latest.length > 1) {
    assert.ok(latest[0].created_at <= latest[latest.length - 1].created_at, 'ascending order');
  }
  console.log('latest rows:', latest.length);

  const hist = await fetchFlightHistory(cfg, flightId);
  assert.ok(Array.isArray(hist), 'history is array');
  assert.ok(hist.length >= latest.length, 'history >= latest window');
  console.log('history rows:', hist.length);
}

const imageUrl = await fetchLatestImageUrl(cfg);
console.log('imageUrl:', imageUrl);
assert.ok(imageUrl === null || imageUrl.startsWith('https://'), 'image url is https or null');

// --- Handler-taso: stubataan caches + ctx, ajetaan oikeat onRequestGet:t ---
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const env = { SUPABASE_URL: cfg.url, SUPABASE_ANON_KEY: cfg.anonKey, SUPABASE_TABLE: cfg.table };
const ctx = (path) => ({ env, request: new Request(`https://example.test${path}`), waitUntil() {} });

const { onRequestGet: history } = await import('../api/history.js');
const hRes = await history(ctx('/api/history'));
assert.equal(hRes.status, 200, 'history 200');
assert.match(hRes.headers.get('cache-control'), /s-maxage=30/, 'history cache 30s');
const hBody = await hRes.json();
assert.ok(Array.isArray(hBody.rows), 'history rows array');
console.log('history handler rows:', hBody.rows.length);

const { onRequestGet: latest } = await import('../api/latest.js');
const lRes = await latest(ctx('/api/latest'));
assert.equal(lRes.status, 200, 'latest 200');
assert.match(lRes.headers.get('cache-control'), /s-maxage=3/, 'latest cache 3s');
const lBody = await lRes.json();
assert.ok(Array.isArray(lBody.rows), 'latest rows array');
assert.ok(lBody.imageUrl === null || lBody.imageUrl.startsWith('https://'), 'latest imageUrl');
console.log('latest handler rows:', lBody.rows.length, 'image:', lBody.imageUrl);

console.log('handlers OK');

console.log('functions.smoke.mjs OK');
