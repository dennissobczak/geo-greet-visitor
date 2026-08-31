"use client";

import React from "react";
import { useGeoGreeting } from "../hooks/useGeoGreeting";
import type { GeoGreetingProps } from "../types";

/**
 * Renders the greeting in a `<span>`. `aria-live` is set so screen readers
 * announce the country once the lookup resolves rather than only the
 * placeholder text.
 */
export function GeoGreeting({
  className,
  loadingText = "Hello My Friend",
  ...options
}: GeoGreetingProps) {
  const { greeting, loading } = useGeoGreeting(options);

  return (
    <span className={className} aria-live="polite">
      {loading ? loadingText : greeting}
    </span>
  );
}
