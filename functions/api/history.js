import { buildHistorySnapshot } from '../_shared/snapshot.js';
import { serveCached, cfgFromEnv } from '../_shared/http.js';

const MAX_AGE_S = 30; // koko historia uusiksi enintään kerran / 30 s / reuna

export async function onRequestGet(context) {
  return serveCached(context, () => buildHistorySnapshot(cfgFromEnv(context.env)), MAX_AGE_S);
}
