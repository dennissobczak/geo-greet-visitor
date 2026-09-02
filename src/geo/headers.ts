/**
 * Layer 1 of country resolution: read the country the hosting platform already
 * worked out for us.
 *
 * Every major edge platform runs its own geolocation before the request ever
 * reaches the app and hands the result over as a header. When one of these is
 * present it beats anything we can derive from the IP ourselves - it is more
 * accurate, it costs nothing, and it needs no data shipped in the bundle.
 */

/**
 * Proxy headers carrying the visitor's IP, in priority order. The first one
 * present wins; a comma-joined value (`x-forwarded-for`) keeps its left-most
 * entry, which is the client.
 */
const IP_HEADERS = [
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

/**
 * Headers carrying a ready-made ISO 3166-1 alpha-2 country code, in priority
 * order. `x-geo-country` is last because it is a generic convention rather than
 * one platform's documented header - a custom proxy can set it to opt in.
 */
const COUNTRY_HEADERS = [
  "x-vercel-ip-country", // Vercel
  "cf-ipcountry", // Cloudflare
  "cloudfront-viewer-country", // AWS CloudFront
  "x-appengine-country", // Google App Engine / Cloud Run behind GFE
  "x-geo-country", // generic / custom proxy
] as const;

/**
 * Values that look like country codes but are not countries. Cloudflare sends
 * `XX` when it cannot place the visitor and `T1` for Tor exit nodes; `AP`/`EU`
 * are region placeholders used by several providers, and `A1`/`A2` mark
 * anonymous proxies and satellite links.
 */
const NON_COUNTRIES = new Set(["XX", "ZZ", "T1", "AP", "EU", "A1", "A2", "O1"]);

/**
 * Normalises anything that claims to be a country code, returning `null` unless
 * it is two ASCII letters naming an actual country.
 */
export function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;

  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;

  return NON_COUNTRIES.has(code) ? null : code;
}

/** Reads the visitor's IP off the request, falling back to loopback. */
export function extractIp(req: Request): string {
  for (const header of IP_HEADERS) {
    const value = req.headers.get(header);
    if (!value) continue;
    const first = value.split(",")[0].trim();
    if (first) return first;
  }
  return "127.0.0.1";
}

/**
 * Reads the country the platform resolved, or `null` when the app is not
 * running behind one that does this - a plain Node server, or local dev.
 */
export function countryFromHeaders(req: Request): string | null {
  for (const header of COUNTRY_HEADERS) {
    const code = normalizeCountry(req.headers.get(header));
    if (code) return code;
  }

  // Netlify packs its geo data into a base64 JSON blob instead of a plain
  // header. Best effort: if the shape is not what we expect, fall through.
  // `atob` rather than `Buffer`, which would tie the server entry to Node.
  const netlify = req.headers.get("x-nf-geo");
  if (netlify) {
    try {
      const json = JSON.parse(atob(netlify)) as { country?: { code?: string } };
      const code = normalizeCountry(json?.country?.code);
      if (code) return code;
    } catch {
      // not base64, not JSON, or no `country.code` - nothing to do.
    }
  }

  return null;
}
