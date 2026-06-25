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

console.log('functions.smoke.mjs OK');
