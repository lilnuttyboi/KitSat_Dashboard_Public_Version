import assert from 'node:assert/strict';
import { buildHistorySnapshot, buildLatestSnapshot } from './snapshot.js';

// Mock fetch: reitittää URL:n perusteella. Palauttaa { ok, json }.
function mockFetch(rows, { imageRoot = [], imageFiles = {} } = {}) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/list/')) {
      const body = JSON.parse(opts.body);
      const data = body.prefix === '' ? imageRoot : (imageFiles[body.prefix] ?? []);
      return { ok: true, json: async () => data };
    }
    if (u.includes('select=flight_id&')) {
      return { ok: true, json: async () => (rows.length ? [{ flight_id: rows[rows.length - 1].flight_id }] : []) };
    }
    // historia/latest: palautetaan rivit (desc jos latest-kysely, muuten asc)
    const desc = u.includes('order=created_at.desc') && !u.includes('select=flight_id');
    const out = [...rows];
    return { ok: true, json: async () => (desc ? out.reverse() : out) };
  };
}

const baseRows = [
  { created_at: '2026-06-25T00:00:00Z', flight_id: 7, gps_lat: 61, gps_lon: 22, gps_alt: 100, gps_speed: 5, gps_fix: true, temp_c: -5, pressure_hpa: 900 },
  { created_at: '2026-06-25T00:00:01Z', flight_id: 7, gps_lat: 61.001, gps_lon: 22.001, gps_alt: 110, gps_speed: 9999, gps_fix: true, temp_c: -6, pressure_hpa: 890 },
  { created_at: '2026-06-25T00:00:02Z', flight_id: 7, gps_lat: 0, gps_lon: 0, gps_fix: false, temp_c: 0, pressure_hpa: 1013.25 }, // bad row
];

const cfg = { url: 'http://x', anonKey: 'k', table: 't', bucket: 'camera' };

// history: bad row pudotettu, nopeuspiikki nullattu, startMs ensimmäisestä rivistä
{
  const snap = await buildHistorySnapshot({ ...cfg, fetchImpl: mockFetch(baseRows) });
  assert.equal(snap.flightId, 7);
  assert.equal(snap.rows.length, 2, 'bad row dropped');
  assert.equal(snap.rows[1].gps_speed, null, 'implausible speed nulled');
  assert.equal(snap.startMs, new Date('2026-06-25T00:00:00Z').getTime());
}

// latest: imageUrl ratkaistaan uusimman created_at:n mukaan eri kansioista
{
  const snap = await buildLatestSnapshot({
    ...cfg,
    fetchImpl: mockFetch(baseRows, {
      imageRoot: [{ id: null, name: '6' }, { id: null, name: '7' }],
      imageFiles: {
        '6': [{ name: 'cap_old.jpg', created_at: '2026-06-25T00:00:00Z' }],
        '7': [{ name: 'cap_new.jpg', created_at: '2026-06-25T00:05:00Z' }],
      },
    }),
  });
  assert.equal(snap.flightId, 7);
  assert.ok(snap.rows.length === 2);
  assert.ok(snap.imageUrl.endsWith('/camera/7/cap_new.jpg'), `got ${snap.imageUrl}`);
}

// tyhjä backend: ei kaadu
{
  const snap = await buildHistorySnapshot({ ...cfg, fetchImpl: mockFetch([]) });
  assert.equal(snap.flightId, null);
  assert.deepEqual(snap.rows, []);
  assert.equal(snap.startMs, null);
}

console.log('snapshot.check.mjs OK');
