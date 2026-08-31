// Regional Indicator Symbol Letter A minus ASCII "A": a two-letter country code
// maps to its flag by shifting both letters into that block.
const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 0x41;

/**
 * Turns an ISO 3166-1 alpha-2 country code into its flag emoji.
 * Returns `""` for anything that is not two ASCII letters, so callers can
 * substitute their own fallback.
 *
 * @example
 * countryFlag("pl") // "🇵🇱"
 */
export function countryFlag(countryCode: string | null | undefined): string {
  if (!countryCode) return "";

  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";

  return String.fromCodePoint(
    code.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET,
    code.charCodeAt(1) + REGIONAL_INDICATOR_OFFSET,
  );
}

/**
 * Translates a country code into `locale`'s language. Falls back to
 * `fallbackName` when no locale is given, the runtime lacks
 * `Intl.DisplayNames`, or the code is unknown.
 *
 * @example
 * localizeCountry("PL", "Poland", "pl") // "Polska"
 */
export function localizeCountry(
  countryCode: string | null | undefined,
  fallbackName: string,
  locale?: string,
): string {
  if (!locale || !countryCode) return fallbackName;

  try {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return names.of(countryCode.trim().toUpperCase()) || fallbackName;
  } catch {
    return fallbackName;
  }
}
