import assert from 'node:assert/strict';
import {
  isBadRow, cleanSpeed, distanceKm, withCleanFix,
} from './clean.js';

// isBadRow: sentinel-rivi (temp 0 / pressure 1013.25 / no fix) hylätään
assert.equal(isBadRow({ temp_c: 0, pressure_hpa: 1013.25, gps_fix: false }), true);
assert.equal(isBadRow({ temp_c: -5, pressure_hpa: 900, gps_fix: true }), false);

// cleanSpeed: yli 300 m/s -> null, kelvollinen säilyy
assert.equal(cleanSpeed(7660), null);
assert.equal(cleanSpeed(-1), null);
assert.equal(cleanSpeed(NaN), null);
assert.equal(cleanSpeed(42), 42);
assert.equal(cleanSpeed(null), null);

// distanceKm: Helsinki -> Tukholma ~395 km
assert.ok(Math.abs(distanceKm(60.17, 24.94, 59.33, 18.07) - 395) < 20);

// withCleanFix: Null Island (lon=0) -> gps_fix false
{
  const last = { value: null };
  const r = withCleanFix({ gps_lat: 0, gps_lon: 21.79, gps_fix: true, created_at: '2026-06-25T00:00:00Z' }, last);
  assert.equal(r.gps_fix, false);
}
// withCleanFix: uskottava liike säilyy ja last päivittyy
{
  const last = { value: null };
  const a = withCleanFix({ gps_lat: 61.0, gps_lon: 22.0, gps_fix: true, created_at: '2026-06-25T00:00:00Z' }, last);
  assert.equal(a.gps_fix, true);
  assert.equal(last.value.lat, 61.0);
}
// withCleanFix: >150 km hyppy 1 s:ssa -> gps_fix false
{
  const last = { value: { lat: 61.0, lon: 22.0, ms: new Date('2026-06-25T00:00:00Z').getTime() } };
  const r = withCleanFix({ gps_lat: 65.0, gps_lon: 28.0, gps_fix: true, created_at: '2026-06-25T00:00:01Z' }, last);
  assert.equal(r.gps_fix, false);
}

console.log('clean.check.mjs OK');
