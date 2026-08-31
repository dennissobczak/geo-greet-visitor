export interface GreetingTokens {
  country: string;
  countryCode: string;
  flag: string;
}

export const DEFAULT_TEMPLATE = "Hello My Friend and greetings to {country} {flag}";

const PLACEHOLDER = /\{(country|countryCode|flag)\}/g;

/**
 * Fills `{country}`, `{countryCode}` and `{flag}` in `template`. Any gap left
 * by an empty token is collapsed, so a missing flag does not leave a double
 * space behind. Unknown placeholders are left untouched.
 */
export function buildGreeting(template: string, tokens: GreetingTokens): string {
  return template
    .replace(PLACEHOLDER, (_match, key: keyof GreetingTokens) => tokens[key])
    .replace(/[ \t]+/g, " ")
    .trim();
}
