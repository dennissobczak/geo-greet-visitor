import { countryFromHeaders, extractIp, normalizeCountry } from "./geo/headers";
import { countryFromIp } from "./geo/table";
import { GENERATED } from "./geo/data";
import type { CountryResolver, GeoData, GeoHandlerOptions } from "./types";

export type { CountryResolver, GeoData, GeoHandlerOptions };
export { extractIp, normalizeCountry } from "./geo/headers";
export { countryFromIp } from "./geo/table";

/** Date of the registry snapshot the offline table was built from. */
export const TABLE_GENERATED = GENERATED;

let displayNames: Intl.DisplayNames | null | undefined;

/**
 * English name for a country code. The client localises this itself when a
 * `locale` is given, so this is only what an unlocalised greeting shows.
 * Falls back to the code on a runtime without region data.
 */
export function countryName(countryCode: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }

  try {
    return displayNames?.of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
}

/**
 * Works out the visitor's country, in decreasing order of trustworthiness:
 *
 * 1. a `resolve` callback, if the caller supplied one - it overrides
 *    everything, which is what makes it a usable escape hatch;
 * 2. the country the hosting platform resolved and put in a header;
 * 3. the offline registry table;
 * 4. `defaultCountry`.
 *
 * Returns `null` when none of them produced a country - notably for loopback
 * and private addresses, which is every request in local development.
 */
async function resolveCountry(
  req: Request,
  ip: string,
  options: GeoHandlerOptions,
): Promise<string | null> {
  const { resolve, defaultCountry, trustPlatformHeaders = true } = options;

  if (resolve) {
    const custom = normalizeCountry(await resolve(ip, req));
    if (custom) return custom;
  }

  if (trustPlatformHeaders) {
    const platform = countryFromHeaders(req);
    if (platform) return platform;
  }

  const table = countryFromIp(ip);
  if (table) return table;

  return normalizeCountry(defaultCountry);
}

/**
 * Resolves an IP to a country through the offline registry table.
 *
 * Kept for callers who want the lookup without the request plumbing. Unlike a
 * geolocation provider it never throws and never reaches the network; an
 * address it cannot place comes back with empty `country` / `countryCode`.
 *
 * `city` and `region` are always `null` - registry data records the country a
 * block was delegated to and nothing finer.
 */
export async function lookupIp(ip: string): Promise<GeoData> {
  const countryCode = countryFromIp(ip) ?? "";

  return {
    country: countryCode ? countryName(countryCode) : "",
    countryCode,
    city: null,
    region: null,
    ip,
  };
}

/**
 * Resolves the visitor behind a request to `GeoData`, in the order described on
 * `resolveCountry`. This is the lookup without the HTTP response around it, for
 * rendering the greeting on the server and handing the result to the client
 * component as a prop.
 *
 * Takes a `Request`, or just its `Headers` - which is what a Next.js server
 * component gets from `headers()`. A `resolve` callback then receives a
 * synthetic request carrying those headers.
 *
 * An unplaceable visitor resolves with empty `country` / `countryCode`; only a
 * throwing `resolve` rejects.
 *
 * @example
 * // app/page.tsx (server component)
 * import { headers } from "next/headers";
 * import { getGeo } from "geo-greet-visitor/api";
 *
 * const geo = await getGeo(await headers());
 * return <GeoGreeting data={geo} />;
 */
export async function getGeo(
  source: Request | Headers,
  options: GeoHandlerOptions = {},
): Promise<GeoData> {
  // Duck-typed rather than `instanceof Request`: polyfilled and framework
  // request classes are not always the global one.
  const req =
    typeof (source as Request).url === "string"
      ? (source as Request)
      : new Request("http://localhost/", { headers: source as Headers });

  const ip = extractIp(req);
  const countryCode = await resolveCountry(req, ip, options);

  // An unresolved country is not an error: the client renders its fallback,
  // which is what local development and unallocated space should look like.
  return {
    country: countryCode ? countryName(countryCode) : "",
    countryCode: countryCode ?? "",
    city: null,
    region: null,
    ip,
  };
}

/**
 * Builds a route handler returning `GeoData` for the calling visitor. Takes a
 * plain `Request`, so it works in any Web-standard runtime; in Next.js the App
 * Router's `NextRequest` satisfies it.
 *
 * The response is marked `no-store` - it is per-visitor by definition and must
 * never end up in a shared cache.
 *
 * @example
 * // app/api/geo/route.ts
 * import { createGeoHandler } from "geo-greet-visitor/api";
 * export const GET = createGeoHandler({ defaultCountry: "DE" });
 */
export function createGeoHandler(
  options: GeoHandlerOptions = {},
): (req: Request) => Promise<Response> {
  return async function handler(req: Request): Promise<Response> {
    const headers = { "Cache-Control": "no-store" };

    try {
      return Response.json(await getGeo(req, options), { headers });
    } catch (err) {
      // Only a caller-supplied `resolve` can throw - the table cannot.
      const message = err instanceof Error ? err.message : "Country lookup failed";
      return Response.json({ error: message }, { status: 500, headers });
    }
  };
}

/**
 * Ready-made handler with default options.
 *
 * @example
 * // app/api/geo/route.ts
 * export { geoHandler as GET } from "geo-greet-visitor/api";
 */
export const geoHandler = createGeoHandler();
