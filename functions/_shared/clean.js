// Telemetrian datan siivous — jaettu Pages Functionsien kesken (yksi totuus).
// Portattu src/hooks/useTelemetry.js:stä; toimii sekä Workers- että Node-ajossa.

export const isBadRow = (d) =>
  d.temp_c === 0 && d.pressure_hpa === 1013.25 && d.gps_fix === false;

// GPS raportoi epäuskottavia nopeuspiikkejä; hylätään yli rajan menevät (-> null).
export const MAX_PLAUSIBLE_SPEED = 300; // m/s
export const cleanSpeed = (v) =>
  typeof v === 'number' && !Number.isNaN(v) && v >= 0 && v <= MAX_PLAUSIBLE_SPEED ? v : null;

export const MAX_JUMP_KM = 150;

export const distanceKm = (aLat, aLon, bLat, bLon) => {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Palauttaa rivin, jonka gps_fix on false jos sijainti ei ole uskottava.
// last = mutatoitava { value: {lat,lon,ms}|null } -säiliö, joka kantaa viimeisen
// kelvollisen sijainnin rivien yli. Sallittu hyppy skaalautuu kuluneen ajan mukaan.
export const withCleanFix = (row, last) => {
  if (!row.gps_fix) return row;
  const lat = row.gps_lat, lon = row.gps_lon;
  const inRange =
    typeof lat === 'number' && typeof lon === 'number' &&
    !Number.isNaN(lat) && !Number.isNaN(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    lat !== 0 && lon !== 0;
  if (!inRange) return { ...row, gps_fix: false };
  const ms = new Date(row.created_at).getTime();
  if (last.value) {
    const elapsedS = Number.isFinite(ms) ? Math.max(1, (ms - last.value.ms) / 1000) : 1;
    const maxJumpKm = Math.max(MAX_JUMP_KM, (elapsedS * MAX_PLAUSIBLE_SPEED) / 1000);
    if (distanceKm(last.value.lat, last.value.lon, lat, lon) > maxJumpKm) {
      return { ...row, gps_fix: false };
    }
  }
  last.value = { lat, lon, ms };
  return row;
};
