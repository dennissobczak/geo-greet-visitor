"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { countryFlag, localizeCountry } from "../flag";
import { buildGreeting, DEFAULT_TEMPLATE } from "../greeting";
import type { GeoData, GeoGreetingOptions, GeoGreetingState } from "../types";

/**
 * Renders `template` with the visitor's country, taken from `data` (resolved on
 * the server with `getGeo`), a bare `countryCode`, or a caller-supplied `load`.
 * The hook itself performs no I/O, which keeps the package free of network
 * access.
 *
 * The greeting is never empty: before `load` resolves - and after it fails, or
 * when no source was given - it renders with `fallback` / `fallbackFlag`, so
 * callers can show it unconditionally and only consult `loading` / `error` if
 * they want to.
 */
export function useGeoGreeting(options: GeoGreetingOptions = {}): GeoGreetingState {
  const {
    data: given,
    countryCode: givenCode,
    load,
    template = DEFAULT_TEMPLATE,
    fallback = "the world",
    fallbackFlag = "🌍",
    locale,
  } = options;

  // `load` only matters when nothing more direct was passed in.
  const shouldLoad = given === undefined && givenCode === undefined && load !== undefined;

  const [loaded, setLoaded] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState<string | null>(null);

  // Read through a ref so an inline `load` - a new function every render - does
  // not re-run the effect, which would loop: resolve, set state, re-render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!shouldLoad) return;

    let cancelled = false;

    async function run() {
      try {
        const body = await loadRef.current!();
        if (cancelled) return;
        setLoaded(body);
        setError(null);
      } catch (err) {
        // A rejection after unmount is nobody's concern any more.
        if (cancelled) return;
        setLoaded(null);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    run();

    return () => {
      cancelled = true;
    };
  }, [shouldLoad]);

  return useMemo(() => {
    const fromCode = given === undefined && givenCode !== undefined;
    const data = given !== undefined ? given : fromCode ? null : loaded;

    // An empty country code - a private address in local development, or
    // unallocated space - is a successful answer, not an error, and renders
    // the fallback.
    const countryCode = ((fromCode ? givenCode : data?.countryCode) ?? "").trim().toUpperCase();

    // `getGeo` supplies an English name; a bare code has none, so derive one.
    const englishName = data?.country || localizeCountry(countryCode, countryCode, "en");
    const country = countryCode ? localizeCountry(countryCode, englishName, locale) : fallback;
    const flag = countryFlag(countryCode) || fallbackFlag;

    return {
      data,
      country,
      countryCode,
      flag,
      greeting: buildGreeting(template, { country, countryCode, flag }),
      loading: shouldLoad && loading,
      error: shouldLoad ? error : null,
    };
  }, [given, givenCode, loaded, shouldLoad, loading, error, template, fallback, fallbackFlag, locale]);
}
