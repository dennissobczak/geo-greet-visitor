# geo-greet-visitor

Greet visitors by their country. The server resolves the caller's IP to a
country, the client renders a template with the country name and its flag
emoji.

```
Hello My Friend and greetings to Poland 🇵🇱
```

- **No third-party geolocation service.** The country comes from the hosting
  platform's own header, or from a registry table compiled into the package.
  Nothing leaves your server, there is no API key, no rate limit and no
  per-request latency.
- Country name is localised through `Intl.DisplayNames` - pass `locale: "pl"`
  and `PL` becomes `Polska`.
- The greeting is never empty: it falls back to `the world 🌍` while loading,
  when the visitor cannot be placed, and on failure.
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

Returns `GeoData` as JSON with `Cache-Control: no-store`. A visitor who cannot
be placed is not an error - the response is still `200` with
`countryCode: ""`, and the client renders its fallback.

### `createGeoHandler(options?)`

The same handler with the resolution order configured:

| Option                 | Default | Meaning                                                                  |
| ---------------------- | ------- | ------------------------------------------------------------------------ |
| `resolve`              | -       | `(ip, req) => code \| null`, tried first. Return `null` to fall through.  |
| `defaultCountry`       | -       | Used when nothing else resolves, instead of leaving the country empty.    |
| `trustPlatformHeaders` | `true`  | Whether to believe `cf-ipcountry` and friends.                           |

```ts
// app/api/geo/route.ts
import { createGeoHandler } from "geo-greet-visitor/api";

export const GET = createGeoHandler({
  // your own database, a cache, a fixed answer in tests - anything
  resolve: (ip) => myGeoDb.lookup(ip)?.country ?? null,
  defaultCountry: "DE",
});
```

Also exported: `extractIp(req)`, `countryFromIp(ip)`, `countryName(code)`,
`normalizeCountry(value)`, `lookupIp(ip)` and `TABLE_GENERATED`.

### Helpers

`countryFlag(code)`, `localizeCountry(code, fallbackName, locale?)`,
`buildGreeting(template, tokens)`, `DEFAULT_TEMPLATE`.

## How the country is resolved

In order, first hit wins:

1. **`resolve`**, if you passed one.
2. **A platform geo header** - `x-vercel-ip-country`, `cf-ipcountry`,
   `cloudfront-viewer-country`, `x-appengine-country`, `x-geo-country`, or
   Netlify's `x-nf-geo`. On Vercel, Cloudflare, CloudFront or App Engine this
   is where every answer comes from: the edge already geolocated the visitor,
   so nothing else runs.
3. **The offline registry table**, keyed on the IP from `extractIp` -
   `x-vercel-forwarded-for`, `cf-connecting-ip`, `x-real-ip`,
   `x-forwarded-for` (left-most value), then `127.0.0.1`.
4. **`defaultCountry`**.

Placeholder codes are rejected along the way: `XX`, `ZZ`, `T1` (Tor), `AP`,
`EU`, `A1`, `A2`, `O1`.

### In local development

Every request arrives from a loopback or private address, which belongs to no
country. The endpoint answers `200` with an empty country and the greeting
renders its fallback:

```
Hello My Friend and greetings to the world 🌍
```

Pass `defaultCountry` if you would rather develop against a real country.

### Accuracy

The table is built from the five regional internet registries' *delegated
extended* statistics files - the public record of which country each block of
address space was delegated to. That is coarser than a commercial geo-IP
database: a pan-European ISP may route a Dutch-delegated block to customers in
three countries, and neither the table nor a platform header sees through a
VPN. It is a rough estimate, good enough to greet someone by their country and
not a substitute for a geolocation service.

Registry data is public and free to redistribute with no attribution or
share-alike obligation - unlike MaxMind GeoLite2 (CC BY-SA 4.0 plus an
account) or DB-IP Lite (CC BY 4.0). Nothing in this package carries a
commercial licence obligation; it stays MIT.

The one condition any of the five registries attaches is APNIC's, printed at
the top of its file: the data is *"freely available for download and use on
the condition that APNIC will not be held responsible for any loss or damage
arising from the use of the information"*, and it records *"where resources
were first allocated or assigned"* rather than where they are in use today.
Both are already covered by the MIT licence's warranty disclaimer and by the
accuracy note above.

The snapshot is committed as `src/geo/data.ts` (~840 KB, server entry only -
it never reaches the browser) and exposed as `TABLE_GENERATED`. Refresh it
with:

```bash
npm run build:geo-table   # python3 scripts/build-geo-table.py
```

## Development

```bash
npm run build           # compile to dist/ (ESM + CJS + .d.ts)
npm run dev             # watch mode
npm run typecheck       # tsc --noEmit
npm test                # smoke test against dist/
npm run build:geo-table # refresh the registry table (needs python3)
```

## License

MIT
