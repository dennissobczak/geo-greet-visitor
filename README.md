# geo-greet-visitor

Greet visitors by their country. The server resolves the caller's IP to a
country, the client renders a template with the country name and its flag
emoji.

```
Hello My Friend and greetings to Poland 🇵🇱
```

- Country name is localised through `Intl.DisplayNames` - pass `locale: "pl"`
  and `PL` becomes `Polska`.
- The greeting is never empty: it falls back to `the world 🌍` while loading
  and when the lookup fails.
- The server entry takes a plain `Request`, so it works in any Web-standard
  runtime; the client entry only needs React.

## Install

```bash
npm install geo-greet-visitor
```

Peer dependencies: `react` and `react-dom` (>= 18).

## Two entry points

| Import                    | Entry           | Runs on |
| ------------------------- | --------------- | ------- |
| `geo-greet-visitor`       | `src/index.ts`  | Client  |
| `geo-greet-visitor/api`   | `src/api.ts`    | Server  |

They are separate because the server entry must never be pulled into a client
bundle, and the client entry is marked `"use client"`.

## Usage (Next.js App Router)

Mount the endpoint:

```ts
// app/api/geo/route.ts
export { geoHandler as GET } from "geo-greet-visitor/api";
```

Render the greeting from a client component:

```tsx
"use client";

import { GeoGreeting } from "geo-greet-visitor";

export function Greeting() {
  return <GeoGreeting locale="en" />;
}
```

Or drive your own markup with the hook:

```tsx
"use client";

import { useGeoGreeting } from "geo-greet-visitor";

export function Greeting() {
  const { greeting, country, flag, loading, error } = useGeoGreeting({
    template: "Hello My Friend and greetings to {country} {flag}",
    fallback: "the world",
    locale: "pl",
  });

  return <p>{loading ? "Hello My Friend" : greeting}</p>;
}
```

## API

### `useGeoGreeting(options?): GeoGreetingState`

| Option         | Default                                            | Meaning                                                        |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `endpoint`     | `"/api/geo"`                                       | URL returning `GeoData` JSON.                                   |
| `template`     | `"Hello My Friend and greetings to {country} {flag}"` | Placeholders: `{country}`, `{countryCode}`, `{flag}`.        |
| `fallback`     | `"the world"`                                      | Country name used while loading and on failure.                 |
| `fallbackFlag` | `"🌍"`                                             | Flag used while loading and on failure.                         |
| `locale`       | -                                                  | BCP 47 tag; translates the country name via `Intl.DisplayNames`. |

Returns `{ data, greeting, country, countryCode, flag, loading, error }`.

### `<GeoGreeting />`

Every hook option, plus `className` and `loadingText`. Renders a `<span>` with
`aria-live="polite"`.

### `geoHandler(req: Request): Promise<Response>`

Returns `GeoData` as JSON with `Cache-Control: no-store`, or
`{ error }` with status `502` when the lookup fails.

Also exported: `extractIp(req)` and `lookupIp(ip)` if you want to build your
own handler.

### Helpers

`countryFlag(code)`, `localizeCountry(code, fallbackName, locale?)`,
`buildGreeting(template, tokens)`, `DEFAULT_TEMPLATE`.

## How the IP is found

`extractIp` reads, in order: `x-vercel-forwarded-for`, `cf-connecting-ip`,
`x-real-ip`, `x-forwarded-for` (left-most value), then falls back to
`127.0.0.1`. Loopback addresses query ip-api.com without a path, which returns
the *server's* location - so local development shows a real country instead of
an error.

> The lookup uses the free `http://ip-api.com` tier: HTTP only, rate-limited to
> roughly 45 requests/minute per server IP, non-commercial use. Swap in your own
> provider by writing a handler around `extractIp` if you need more.

## Development

```bash
npm run build      # compile to dist/ (ESM + CJS + .d.ts)
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
```

## License

MIT
