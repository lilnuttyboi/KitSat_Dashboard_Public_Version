// Rakentaa /api/history- ja /api/latest-vastausten hyötykuormat: hakee datan
// (supabase.js) ja siivoaa sen (clean.js) — yksi totuus siivouslogiikalle.
import { isBadRow, cleanSpeed, withCleanFix } from './clean.js';
import {
  selectCurrentFlightId, fetchFlightHistory, fetchLatestRows, fetchLatestImageUrl,
} from './supabase.js';

const cleanRows = (raw) => {
  const last = { value: null }; // withCleanFix mutatoi: jatkuva sijaintivertailu ikkunan yli
  return raw
    .filter((d) => !isBadRow(d))
    .map((d) => withCleanFix({ ...d, gps_speed: cleanSpeed(d.gps_speed) }, last));
};

export async function buildHistorySnapshot(cfg) {
  const flightId = await selectCurrentFlightId(cfg);
  if (flightId == null) return { flightId: null, startMs: null, rows: [] };
  const rows = cleanRows(await fetchFlightHistory(cfg, flightId));
  const startMs = rows.length ? new Date(rows[0].created_at).getTime() : null;
  return { flightId, startMs, rows };
}

export async function buildLatestSnapshot(cfg) {
  const flightId = await selectCurrentFlightId(cfg);
  const rows = flightId == null ? [] : cleanRows(await fetchLatestRows(cfg, flightId, 60));
  const imageUrl = await fetchLatestImageUrl(cfg);
  return { flightId, rows, imageUrl };
}
