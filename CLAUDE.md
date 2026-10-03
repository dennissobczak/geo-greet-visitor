# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build           # compile to dist/ (ESM + CJS + .d.ts)
npm run dev             # watch mode build
npm run typecheck       # tsc --noEmit
npm test                # smoke test against dist/ (plain node, no framework)
npm run build:geo-table # regenerate src/geo/data.ts (needs python3 + network)
```

There is no linter configured yet.

## Architecture

This is a publishable npm library (`geo-greet-visitor`). It has **two separate package entry points**, both compiled by tsup:

| Export                  | Entry          | Who uses it                             |
| ----------------------- | -------------- | --------------------------------------- |
| `geo-greet-visitor`     | `src/index.ts` | Client components                       |
| `geo-greet-visitor/api` | `src/api.ts`   | Server route handlers (any Web runtime) |

The split exists because `src/api.ts` is server-only while `src/index.ts` exports `"use client"` code. Bundling them together would cause Next.js to complain about server/client boundary violations.

`src/api.ts` takes a plain `Request`, not `NextRequest` - the library has no `next` dependency at all, so the handler also works in Remix, Hono, Bun, Deno or a bare fetch server. Next's `NextRequest` is a subtype of `Request`, so `export { geoHandler as GET }` still typechecks.

### Data flow

```
Server (component, loader, or route handler)
  → getGeo(request | headers)            # geoHandler is getGeo + Response.json
      → resolve() callback               # 1. caller's escape hatch
      → platform geo header              # 2. cf-ipcountry, x-vercel-ip-country, ...
      → offline registry table           # 3. src/geo/data.ts, keyed on extractIp()
      → defaultCountry                   # 4. configured fallback
  ← GeoData
Client component
  ← data prop | countryCode prop | caller's load()   # first one set wins
  ← greeting string = template + localised country + flag emoji
```

Nothing here leaves the server: there is no external geolocation provider, no
API key and no rate limit.

**The package makes no network calls, in either entry.** socket.dev flags any
`fetch` as a "network access" supply-chain alert, which is why 3.0 removed the
hook's built-in request to `/api/geo`. A browser-only consumer passes a `load`
function, so the request lives in their code. `npm test` fails if `dist/`
references `fetch`, `XMLHttpRequest`, `WebSocket` or a Node network module -
do not add one back, and do not obfuscate one past the check.

### Key design decisions

- **`tsup.config.ts` is an array of two configs, not one config with two entries.** esbuild strips the `"use client"` directive during bundling, so the client entry re-adds it via `banner`. That banner must not reach the server entry, hence the split. tsup runs array configs in order, so only the first carries `clean: true`.
- **Country resolution is offline and layered** (`src/api.ts`, `src/geo/`). A platform geo header beats the table when there is one - it is more accurate than registry data and costs nothing - so on Vercel/Cloudflare/CloudFront the table is never consulted. `resolve` sits in front of everything so a consumer can plug in a real geo-IP database without forking the handler.
- **IP extraction priority** in `extractIp`: `x-vercel-forwarded-for` → `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` (left-most value) → `127.0.0.1`.
- **An unresolved country is a result, not an error.** Private and loopback addresses belong to no country, so every local-dev lookup returns `countryCode: ""` (a 200 from the handler) and the client renders `the world 🌍`. Only a throwing `resolve` makes `getGeo` reject and the handler return 500. The hook keys its fallback off an empty `countryCode`, not off `data === null`.
- **`getGeo` accepts `Headers` as well as `Request`**, because a Next.js server component only has `await headers()`. It detects a `Request` by its `url` (duck-typed, not `instanceof`) and otherwise wraps the headers in a synthetic `Request` for `extractIp` and `resolve`.
- **`src/geo/data.ts` is generated, ~840 KB, and must not be hand-edited.** It holds 138k IPv4 and 40k IPv6 ranges from the five RIRs' `delegated-extended` files, encoded as three integers per range (gap, length, country index) in little-endian base 32 with a continuation bit - no separators, which is a third smaller than delimited base 36. `decode()` in `src/geo/table.ts` is the only reader and must stay in step with `encode_int()` in the generator. Decoding is lazy, so a request answered by a platform header never pays for it.
- **RIR data, not GeoLite2.** Registry files are public and free to redistribute with no attribution or share-alike terms; MaxMind GeoLite2 (CC BY-SA 4.0 + account) and DB-IP Lite (CC BY 4.0) would put obligations on an MIT package. The accuracy is delegation-level - the country a block was assigned to, not where the packet is - which is all the greeting needs.
- **The generator is Python** (`scripts/build-geo-table.py`, stdlib only) because it is a maintainer tool run by hand; keeping it out of `npm run build` means consumers never need it and the package gains no dependency.
- **IPv6 is keyed on the top 32 bits** of the prefix. RIRs allocate to LIRs at /19 to /32, so those bits identify the holder, and it keeps both families in one 32-bit binary search.
- **Flags come from the country code, not a lookup table.** `countryFlag` shifts the two ASCII letters into the Regional Indicator Symbol block. Anything that is not two letters returns `""`, and the hook substitutes `fallbackFlag`.
- **Country names are localised client-side** via `Intl.DisplayNames`, because the server only knows the country *code*. `countryName` (server) fills in the English name for the unlocalised case; `localizeCountry` (client) returns that name unchanged when no `locale` is passed or the runtime lacks the API.
- **`buildGreeting` collapses runs of spaces** after substitution, so a template like `"...{country} {flag}"` does not leave a trailing gap when the flag is empty.
- **Sources in `useGeoGreeting`**: `data` beats `countryCode` beats `load`. `load` runs only when the other two are `undefined`, once per mount: it is read through a ref and the effect depends on a boolean, so an inline arrow (a new function every render) does not loop. A bare `countryCode` has no server-supplied name, so the English name is derived with `localizeCountry(code, code, "en")`.
- **Cancellation**: the effect sets a `cancelled` flag on cleanup and checks it before the `catch` body, so a `load` that settles after unmount is ignored rather than reported as an error. There is no `AbortController` - the hook owns no request to abort.
- **Derived state is memoised, not stored.** Only the loaded data / `loading` / `error` live in state; `greeting`, `country`, `flag` are recomputed in `useMemo`, so changing `template` or `locale` re-renders without reloading.
- **Fallbacks**: the greeting always resolves - `fallback` (default `"the world"`) and `fallbackFlag` (default `"🌍"`) cover loading, failure and no source at all. `loading` and `error` only ever change when `load` is used.

### Consumer integration (Next.js App Router)

```tsx
// app/page.tsx - server component resolves, client component renders
import { headers } from "next/headers";
import { getGeo } from "geo-greet-visitor/api";
import { GeoGreeting } from "geo-greet-visitor";

const geo = await getGeo(await headers());
<GeoGreeting data={geo} locale="pl" />  // <span>Hello My Friend and greetings to Polska 🇵🇱</span>
```

```tsx
// browser-only: consumer mounts the endpoint and owns the request
export { geoHandler as GET } from "geo-greet-visitor/api";   // app/api/geo/route.ts

const { greeting, country, flag, loading, error } = useGeoGreeting({
  load: () => fetch("/api/geo").then((r) => r.json()),
  template: "Hello My Friend and greetings to {country} {flag}",
  locale: "en",
});
```

### Types (`src/types.ts`)

All public-facing interfaces live here. The client ones (including `GeoLoader`) are re-exported from `src/index.ts`; `GeoHandlerOptions` and `CountryResolver` are server-side and come out of `src/api.ts` only. `GeoGreetingProps` extends `GeoGreetingOptions` - the component accepts every hook option plus `className` and `loadingText`. `GeoData.city` and `GeoData.region` are deprecated and always `null`: registry data has no sub-country detail, and they are kept only so the shape does not break consumers.
