// Reunavälimuisti (Workers Cache API) + JSON-vastaus. serveCached koalesoi:
// osuma palautetaan suoraan, ohi vain kerran per TTL per reuna -> Supabasen
// kuorma ~1/TTL/reuna, ei katsojamäärän mukaan.

export function jsonResponse(obj, status, maxAge) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`,
    },
  });
}

export async function serveCached(context, buildFn, maxAge) {
  const { request, waitUntil } = context;
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  let body;
  try {
    body = await buildFn();
  } catch (err) {
    // Virhettä ei cachetata pitkään (max-age 0), jotta toipuminen on nopeaa.
    return jsonResponse({ error: 'unavailable', detail: String(err?.message ?? err) }, 503, 0);
  }
  const res = jsonResponse(body, 200, maxAge);
  waitUntil(cache.put(request, res.clone()));
  return res;
}

// Lukee Supabase-asetukset Pages-ympäristömuuttujista.
export function cfgFromEnv(env) {
  return { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, table: env.SUPABASE_TABLE, bucket: 'camera' };
}
