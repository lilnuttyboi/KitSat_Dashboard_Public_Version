import { buildLatestSnapshot } from '../_shared/snapshot.js';
import { serveCached, cfgFromEnv } from '../_shared/http.js';

const MAX_AGE_S = 3; // live-tail: tuore ~3 s

export async function onRequestGet(context) {
  return serveCached(context, () => buildLatestSnapshot(cfgFromEnv(context.env)), MAX_AGE_S);
}
