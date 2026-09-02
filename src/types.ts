export interface GeoData {
  /** English country name, or `""` when the visitor could not be placed. */
  country: string;
  /** ISO 3166-1 alpha-2 code, e.g. "PL", or `""` when unresolved. */
  countryCode: string;
  /**
   * @deprecated Always `null`. Country resolution is offline now and registry
   * data records only the country a block was delegated to.
   */
  city: string | null;
  /** @deprecated Always `null`, for the same reason as {@link GeoData.city}. */
  region: string | null;
  ip: string;
}

/**
 * Caller-supplied country lookup, tried before anything built in. Return an
 * ISO 3166-1 alpha-2 code, or `null` to fall through to the normal order.
 */
export type CountryResolver = (
  ip: string,
  req: Request,
) => string | null | undefined | Promise<string | null | undefined>;

export interface GeoHandlerOptions {
  /**
   * Overrides the built-in resolution entirely - plug in a geo-IP database, a
   * cache, or a fixed answer for tests. Falling through is free: return `null`
   * and the handler carries on with the platform header and the offline table.
   */
  resolve?: CountryResolver;
  /**
   * Country used when nothing else resolves. Leave unset and an unplaceable
   * visitor - every request in local development - renders the client's
   * fallback instead.
   */
  defaultCountry?: string;
  /**
   * Whether to believe the country headers set by Vercel, Cloudflare and
   * friends. Defaults to `true`. Set it to `false` when the app is reachable
   * without passing through such a platform, since a client can send those
   * headers itself.
   */
  trustPlatformHeaders?: boolean;
}

export interface GeoGreetingState {
  /** Raw lookup result, or `null` while loading and after a failure. */
  data: GeoData | null;
  /** Rendered greeting - always a usable string, even on failure. */
  greeting: string;
  /** Country name after localisation, or the fallback. */
  country: string;
  /** ISO 3166-1 alpha-2 code, or `""` when unknown. */
  countryCode: string;
  /** Flag emoji for the country, or the fallback flag. */
  flag: string;
  loading: boolean;
  error: string | null;
}

export interface GeoGreetingOptions {
  /** Endpoint that returns `GeoData` JSON. Defaults to `"/api/geo"`. */
  endpoint?: string;
  /**
   * Greeting template. Supported placeholders: `{country}`, `{countryCode}`,
   * `{flag}`. Defaults to `"Hello My Friend and greetings to {country} {flag}"`.
   */
  template?: string;
  /** Country name used when the lookup fails. Defaults to `"the world"`. */
  fallback?: string;
  /** Flag used when the lookup fails or the code is unknown. Defaults to `"🌍"`. */
  fallbackFlag?: string;
  /**
   * BCP 47 tag used to translate the country name via `Intl.DisplayNames`
   * (e.g. `"pl"` turns `PL` into `"Polska"`). Omit to keep the provider's
   * English name.
   */
  locale?: string;
}

export interface GeoGreetingProps extends GeoGreetingOptions {
  className?: string;
  /** Shown until the lookup resolves. Defaults to `"Hello My Friend"`. */
  loadingText?: string;
}
