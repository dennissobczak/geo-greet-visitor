export interface GeoData {
  /** Country name as reported by the lookup provider (English). */
  country: string;
  /** ISO 3166-1 alpha-2 code, e.g. "PL". */
  countryCode: string;
  city: string | null;
  region: string | null;
  ip: string;
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
