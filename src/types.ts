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

/**
 * Caller-supplied loader for the browser-only case, where nothing rendered on
 * the server can pass the data down. The package itself makes no network
 * requests, so loading - typically a request to a route mounted with
 * `geoHandler` - is the caller's code.
 */
export type GeoLoader = () => Promise<GeoData>;

export interface GeoGreetingState {
  /**
   * The `data` option, or what `load` resolved to. `null` while loading, after
   * a failure, and when only `countryCode` was given.
   */
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

/**
 * Where the country comes from. Give one of `data`, `countryCode` or `load`;
 * when several are set the first in that order wins. With none, the greeting
 * renders its fallback.
 */
export interface GeoGreetingOptions {
  /**
   * Result of `getGeo` from `geo-greet-visitor/api`, resolved on the server and
   * passed down. `null` renders the fallback.
   */
  data?: GeoData | null;
  /** ISO 3166-1 alpha-2 code, when the country is already known some other way. */
  countryCode?: string | null;
  /**
   * Loads the data in the browser. Runs once on mount - remount the component
   * (change its `key`) to run it again - so an inline arrow is fine.
   */
  load?: GeoLoader;
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
  /** Shown until `load` resolves. Defaults to `"Hello My Friend"`. */
  loadingText?: string;
}
