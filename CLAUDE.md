# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # compile to dist/ (ESM + CJS + .d.ts)
npm run dev        # watch mode build
npm run typecheck  # tsc --noEmit
```

There are no tests or linter configured yet.

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
Browser client component
  → fetch("/api/geo")                    # default endpoint
      → route handler (geoHandler)       # mounted by consumer in their app
          → ip-api.com/json/{ip}         # external lookup, server-side only
      ← GeoData JSON (Cache-Control: no-store)
  ← useGeoGreeting hook updates state
  ← greeting string = template + localised country + flag emoji
```

### Key design decisions

- **`tsup.config.ts` is an array of two configs, not one config with two entries.** esbuild strips the `"use client"` directive during bundling, so the client entry re-adds it via `banner`. That banner must not reach the server entry, hence the split. tsup runs array configs in order, so only the first carries `clean: true`.
- **IP extraction priority** in `extractIp`: `x-vercel-forwarded-for` → `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` (left-most value) → `127.0.0.1`. Loopback IPs hit `ip-api.com/json` (no path), which returns the server's own location - useful for local dev.
- **Flags come from the country code, not a lookup table.** `countryFlag` shifts the two ASCII letters into the Regional Indicator Symbol block. Anything that is not two letters returns `""`, and the hook substitutes `fallbackFlag`.
- **Country names are localised client-side** via `Intl.DisplayNames`, because ip-api.com only returns English names. `localizeCountry` returns the provider's name unchanged when no `locale` is passed or the runtime lacks the API.
- **`buildGreeting` collapses runs of spaces** after substitution, so a template like `"...{country} {flag}"` does not leave a trailing gap when the flag is empty.
- **Cancellation** in `useGeoGreeting`: the effect sets a `cancelled` flag *and* aborts the fetch on cleanup. The `cancelled` check runs before the `catch` body, so an abort is never reported as an error.
- **Derived state is memoised, not stored.** Only `data` / `loading` / `error` live in state; `greeting`, `country`, `flag` are recomputed in `useMemo`, so changing `template` or `locale` re-renders without re-fetching. The effect depends on `endpoint` alone for the same reason.
- **Fallbacks**: the greeting always resolves - `fallback` (default `"the world"`) and `fallbackFlag` (default `"🌍"`) cover both the loading and the failed state. `error` is exposed for callers who want to handle failure explicitly.

### Consumer integration (Next.js App Router)

```ts
// app/api/geo/route.ts - one-liner to wire up the endpoint
export { geoHandler as GET } from "geo-greet-visitor/api";
```

```tsx
// any client component
"use client";
import { GeoGreeting, useGeoGreeting } from "geo-greet-visitor";

<GeoGreeting locale="pl" />  // <span>Hello My Friend and greetings to Polska 🇵🇱</span>

const { greeting, country, flag, loading, error } = useGeoGreeting({
  template: "Hello My Friend and greetings to {country} {flag}",
  fallback: "the world",
  locale: "en",
  endpoint: "/api/geo",
});
```

### Types (`src/types.ts`)

All public-facing interfaces live here and are re-exported from `src/index.ts`. `GeoGreetingProps` extends `GeoGreetingOptions` - the component accepts every hook option plus `className` and `loadingText`.
