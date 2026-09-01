/**
 * Smoke test for the built package.
 *
 * No test framework is configured, so this runs on plain `node`. It checks the
 * two published entry points in both module formats: that they load at all,
 * that the public surface documented in README.md is present, and that the pure
 * helpers behave. Nothing here touches the network - `geoHandler` is only
 * checked for shape, since exercising it would hit ip-api.com.
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

for (const [label, mod] of [
  ["esm", esmApi],
  ["cjs", cjsApi],
]) {
  check(`api ${label} exports geoHandler as a function`, () => {
    assert.ok(!(mod instanceof Error), mod instanceof Error ? mod.message : "");
    assert.equal(typeof mod.geoHandler, "function");
  });
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
