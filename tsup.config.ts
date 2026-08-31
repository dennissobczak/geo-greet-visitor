import { defineConfig } from "tsup";

// Two configs rather than two entries in one: esbuild drops the "use client"
// directive when it bundles, so the client entry needs it re-added as a banner
// - and that banner must NOT land on the server-only `api` entry.
// tsup runs array configs in order, so `clean` belongs to the first one only.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom"],
    treeshake: true,
    banner: { js: '"use client";' },
  },
  {
    entry: { api: "src/api.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    external: ["react", "react-dom"],
    treeshake: true,
  },
]);
