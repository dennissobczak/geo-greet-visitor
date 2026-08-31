import type { GeoData } from "./types";

export type { GeoData };

interface IpApiResponse {
  status: string;
  message?: string;
  country: string;
  countryCode: string;
  city: string;
  regionName: string;
  query: string;
}

const IP_API_FIELDS = "status,message,country,countryCode,city,regionName,query";

/**
 * Proxy headers in priority order. The first one present wins; a comma-joined
 * value (`x-forwarded-for`) keeps its left-most entry, which is the client.
 */
const IP_HEADERS = [
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

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
 * Resolves an IP to a country through ip-api.com. Loopback addresses query the
 * bare endpoint, which returns the *server's* own location - that is what makes
 * the greeting show something during local development.
 */
export async function lookupIp(ip: string): Promise<GeoData> {
  const target = LOOPBACK.includes(ip) ? "" : `/${encodeURIComponent(ip)}`;
  const res = await fetch(`http://ip-api.com/json${target}?fields=${IP_API_FIELDS}`, {
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`ip-api.com returned ${res.status}`);

  const body: IpApiResponse = await res.json();
  if (body.status !== "success") {
    throw new Error(body.message ?? "ip-api.com lookup failed");
  }

  return {
    country: body.country,
    countryCode: body.countryCode,
    city: body.city || null,
    region: body.regionName || null,
    ip: body.query,
  };
}

/**
 * Route handler returning `GeoData` for the calling visitor. Takes a plain
 * `Request`, so it works in any Web-standard runtime; in Next.js the App
 * Router's `NextRequest` satisfies it.
 *
 * The response is marked `no-store` - it is per-visitor by definition and must
 * never end up in a shared cache.
 *
 * @example
 * // app/api/geo/route.ts
 * export { geoHandler as GET } from "geo-greet-visitor/api";
 */
export async function geoHandler(req: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };

  try {
    const data = await lookupIp(extractIp(req));
    return Response.json(data, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return Response.json({ error: message }, { status: 502, headers });
  }
}
