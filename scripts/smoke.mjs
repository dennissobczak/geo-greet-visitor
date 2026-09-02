/**
 * Smoke test for the built package.
 *
 * No test framework is configured, so this runs on plain `node`. It checks the
 * two published entry points in both module formats: that they load at all,
 * that the public surface documented in README.md is present, and that the
 * helpers behave. Country resolution is offline, so `geoHandler` is exercised
 * for real here - nothing in this file touches the network.
 *
 * File names follow tsup's defaults for a package without `"type": "module"`:
 * CJS is `*.js`, ESM is `*.mjs`. They must stay in step with the `exports` map
 * in package.json - the "declared exports resolve" check below is what keeps
 * those two honest.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const pkg = require(path.join(root, "package.json"));

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// `import()` needs a file:// URL to work on Windows.
const loadEsm = (file) => import(pathToFileURL(path.join(dist, file)).href);
const loadCjs = (file) => require(path.join(dist, file));

// --- artifacts -------------------------------------------------------------

const artifacts = [
  "index.js", // cjs
  "index.mjs", // esm
  "index.d.ts",
  "index.d.mts",
  "api.js",
  "api.mjs",
  "api.d.ts",
  "api.d.mts",
];

for (const file of artifacts) {
  check(`dist/${file} exists`, () => {
    assert.ok(
      existsSync(path.join(dist, file)),
      `missing dist/${file} - run \`npm run build\``,
    );
  });
}

// --- the exports map points at files that exist ----------------------------

check("every path in package.json `exports` exists", () => {
  const targets = [];
  const walk = (node) => {
    if (typeof node === "string") targets.push(node);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(pkg.exports);
  walk(pkg.main);
  walk(pkg.module);
  walk(pkg.types);

  for (const target of targets) {
    assert.ok(
      existsSync(path.join(root, target)),
      `package.json points at ${target}, which was not built`,
    );
  }
});

// --- client entry (ESM + CJS) ---------------------------------------------

const clientExports = [
  "useGeoGreeting",
  "GeoGreeting",
  "countryFlag",
  "localizeCountry",
  "buildGreeting",
  "DEFAULT_TEMPLATE",
];

const esmClient = await loadEsm("index.mjs").catch((error) => error);
const cjsClient = (() => {
  try {
    return loadCjs("index.js");
  } catch (error) {
    return error;
  }
})();

for (const [label, mod] of [
  ["esm", esmClient],
  ["cjs", cjsClient],
]) {
  check(`client ${label} entry loads`, () => {
    assert.ok(!(mod instanceof Error), mod instanceof Error ? mod.message : "");
  });

  for (const name of clientExports) {
    check(`client ${label} exports ${name}`, () => {
      assert.ok(!(mod instanceof Error), "entry failed to load");
      assert.notEqual(mod[name], undefined, `${name} is not exported`);
    });
  }
}

// --- server entry (ESM + CJS) ---------------------------------------------

const esmApi = await loadEsm("api.mjs").catch((error) => error);
const cjsApi = (() => {
  try {
    return loadCjs("api.js");
  } catch (error) {
    return error;
  }
})();

const apiExports = [
  "geoHandler",
  "createGeoHandler",
  "extractIp",
  "countryFromIp",
  "countryName",
  "normalizeCountry",
  "lookupIp",
];

for (const [label, mod] of [
  ["esm", esmApi],
  ["cjs", cjsApi],
]) {
  for (const name of apiExports) {
    check(`api ${label} exports ${name} as a function`, () => {
      assert.ok(!(mod instanceof Error), mod instanceof Error ? mod.message : "");
      assert.equal(typeof mod[name], "function");
    });
  }
}

// --- the server/client boundary the two tsup configs exist to protect ------

// A directive only counts when it leads the file, so check the position, not
// just the presence - `treeshake: true` used to leave it stripped entirely.
const USE_CLIENT = /^\s*(["'])use client\1\s*;?/;

for (const file of ["api.js", "api.mjs"]) {
  check(`dist/${file} carries no 'use client' banner`, async () => {
    const source = await readFile(path.join(dist, file), "utf8");
    assert.ok(
      !source.includes("use client"),
      `dist/${file} must stay server-only`,
    );
  });
}

for (const file of ["index.js", "index.mjs"]) {
  check(`dist/${file} leads with the 'use client' banner`, async () => {
    const source = await readFile(path.join(dist, file), "utf8");
    assert.match(
      source,
      USE_CLIENT,
      `dist/${file} must start with "use client" for bundlers to honour it`,
    );
  });
}

// --- behaviour -------------------------------------------------------------

const helpers = esmClient instanceof Error ? {} : esmClient;
const { countryFlag, localizeCountry, buildGreeting, DEFAULT_TEMPLATE } =
  helpers;

check("countryFlag maps a country code to regional indicators", () => {
  assert.equal(countryFlag("PL"), "\u{1F1F5}\u{1F1F1}");
  assert.equal(countryFlag("de"), "\u{1F1E9}\u{1F1EA}");
});

check("countryFlag returns an empty string for non-codes", () => {
  assert.equal(countryFlag(""), "");
  assert.equal(countryFlag("XYZ"), "");
  assert.equal(countryFlag(null), "");
});

check("localizeCountry falls back to the provider name", () => {
  assert.equal(localizeCountry("PL", "Poland"), "Poland");
});

check("localizeCountry localises when a locale is given", () => {
  const localized = localizeCountry("PL", "Poland", "pl");
  // A small-icu runtime has no Polish region data and falls back by design.
  const hasIcuData =
    typeof Intl.DisplayNames === "function" &&
    Intl.DisplayNames.supportedLocalesOf(["pl"]).length > 0;
  assert.equal(localized, hasIcuData ? "Polska" : "Poland");
});

check("buildGreeting substitutes country and flag", () => {
  const greeting = buildGreeting(DEFAULT_TEMPLATE, {
    country: "Poland",
    countryCode: "PL",
    flag: "\u{1F1F5}\u{1F1F1}",
  });
  assert.ok(greeting.includes("Poland"));
  assert.ok(greeting.includes("\u{1F1F5}\u{1F1F1}"));
});

check("buildGreeting collapses the gap left by an empty flag", () => {
  const greeting = buildGreeting("Hello {country} {flag}", {
    country: "Poland",
    countryCode: "PL",
    flag: "",
  });
  assert.equal(greeting, "Hello Poland");
});

// --- offline country resolution --------------------------------------------

const api = esmApi instanceof Error ? {} : esmApi;
const { geoHandler, createGeoHandler, countryFromIp, extractIp } = api;

const get = (headers = {}) =>
  new Request("https://example.test/api/geo", { headers });
const body = async (handler, headers) => (await handler(get(headers))).json();

check("extractIp prefers the platform header over x-forwarded-for", () => {
  assert.equal(
    extractIp(get({ "cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1, 9.9.9.9" })),
    "8.8.8.8",
  );
  assert.equal(extractIp(get({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "1.1.1.1");
  assert.equal(extractIp(get()), "127.0.0.1");
});

check("countryFromIp places IPv4, IPv6 and IPv4-mapped addresses", () => {
  assert.equal(countryFromIp("8.8.8.8"), "US");
  assert.equal(countryFromIp("1.1.1.1"), "AU");
  assert.equal(countryFromIp("193.0.6.139"), "NL");
  assert.equal(countryFromIp("::ffff:8.8.8.8"), "US");
  assert.equal(countryFromIp("2001:4860:4860::8888"), "US");
});

check("countryFromIp returns null for addresses that belong to no country", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "100.64.0.1",
    "169.254.1.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "not an ip",
    "",
  ]) {
    assert.equal(countryFromIp(ip), null, `${ip} should not resolve`);
  }
});

check("geoHandler resolves a public IP from the offline table", async () => {
  const res = await geoHandler(get({ "x-forwarded-for": "8.8.8.8" }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const data = await res.json();
  assert.equal(data.countryCode, "US");
  assert.equal(data.ip, "8.8.8.8");
  assert.ok(data.country.length > 2, "country should be a name, not the code");
  assert.equal(data.city, null);
  assert.equal(data.region, null);
});

check("a platform country header wins over the IP table", async () => {
  const data = await body(geoHandler, {
    "cf-ipcountry": "PL",
    "x-forwarded-for": "8.8.8.8",
  });
  assert.equal(data.countryCode, "PL");
});

check("placeholder country codes fall through to the table", async () => {
  // Cloudflare sends XX when it cannot place the visitor, T1 for Tor.
  for (const code of ["XX", "T1", "EU"]) {
    const data = await body(geoHandler, {
      "cf-ipcountry": code,
      "x-forwarded-for": "8.8.8.8",
    });
    assert.equal(data.countryCode, "US", `${code} should not be taken as a country`);
  }
});

check("a loopback visitor resolves to nothing, not an error", async () => {
  const res = await geoHandler(get());
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.countryCode, "");
  assert.equal(data.country, "");
  assert.equal(data.ip, "127.0.0.1");
});

check("defaultCountry fills in for an unplaceable visitor", async () => {
  const data = await body(createGeoHandler({ defaultCountry: "DE" }));
  assert.equal(data.countryCode, "DE");
});

check("resolve overrides the platform header and the table", async () => {
  const handler = createGeoHandler({ resolve: () => "JP" });
  const data = await body(handler, { "cf-ipcountry": "PL", "x-forwarded-for": "8.8.8.8" });
  assert.equal(data.countryCode, "JP");
});

check("resolve returning null falls through to the rest", async () => {
  const handler = createGeoHandler({ resolve: () => null });
  const data = await body(handler, { "x-forwarded-for": "8.8.8.8" });
  assert.equal(data.countryCode, "US");
});

check("resolve may be async", async () => {
  const handler = createGeoHandler({ resolve: async () => "IT" });
  assert.equal((await body(handler)).countryCode, "IT");
});

check("trustPlatformHeaders: false ignores the header", async () => {
  const handler = createGeoHandler({ trustPlatformHeaders: false });
  const data = await body(handler, { "cf-ipcountry": "PL", "x-forwarded-for": "8.8.8.8" });
  assert.equal(data.countryCode, "US");
});

check("a throwing resolve is reported rather than swallowed", async () => {
  const handler = createGeoHandler({
    resolve: () => {
      throw new Error("resolver exploded");
    },
  });
  const res = await handler(get());
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "resolver exploded");
});

// --- run -------------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error.message}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
