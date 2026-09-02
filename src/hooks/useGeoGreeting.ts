"use client";

import { useEffect, useMemo, useState } from "react";
import { countryFlag, localizeCountry } from "../flag";
import { buildGreeting, DEFAULT_TEMPLATE } from "../greeting";
import type { GeoData, GeoGreetingOptions, GeoGreetingState } from "../types";

/**
 * Looks the visitor's country up through `endpoint` and renders `template`
 * with it. The greeting is never empty: before the lookup resolves - and after
 * it fails - it renders with `fallback` / `fallbackFlag`, so callers can show
 * it unconditionally and only consult `loading` / `error` if they want to.
 */
export function useGeoGreeting(options: GeoGreetingOptions = {}): GeoGreetingState {
  const {
    endpoint = "/api/geo",
    template = DEFAULT_TEMPLATE,
    fallback = "the world",
    fallbackFlag = "🌍",
    locale,
  } = options;

  const [data, setData] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchGeo() {
      try {
        const res = await fetch(endpoint, { signal: controller.signal });
        if (!res.ok) throw new Error(`Geo endpoint returned ${res.status}`);
        const body: GeoData = await res.json();

        if (cancelled) return;
        setData(body);
        setError(null);
      } catch (err) {
        // An aborted request means the effect was torn down, not a failure.
        if (cancelled) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    fetchGeo();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint]);

  return useMemo(() => {
    // The endpoint answers with an empty country code for a visitor it cannot
    // place - a private address in local development, or unallocated space -
    // which is a successful response, not an error, and renders the fallback.
    const countryCode = data?.countryCode ?? "";
    const country = countryCode
      ? localizeCountry(countryCode, data?.country || countryCode, locale)
      : fallback;
    const flag = countryFlag(countryCode) || fallbackFlag;

    return {
      data,
      country,
      countryCode,
      flag,
      greeting: buildGreeting(template, { country, countryCode, flag }),
      loading,
      error,
    };
  }, [data, loading, error, template, fallback, fallbackFlag, locale]);
}
