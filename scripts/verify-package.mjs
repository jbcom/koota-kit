#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmNeedsShell = process.platform === "win32";
// pnpm forwards its own npm_config_* settings to child processes. Newer npm
// versions warn about pnpm-only keys, so give this read-only pack inspection a
// clean npm configuration while preserving PATH, HOME, and other environment.
// npm always runs "prepare" for `npm pack`/`npm publish` regardless of
// --ignore-scripts (it exists precisely to build-before-publish), so this
// package's own git-hook installer would otherwise print an [INFO] line
// into the same stdout stream as npm's --json output. Silence it — hook
// installation is irrelevant to a packaging dry-run.
const npmEnvironment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
  ),
  SKIP_INSTALL_SIMPLE_GIT_HOOKS: "1",
};

// `react` is an OPTIONAL peer dependency used only by `koota-kit/react`. Walk
// each built entry's relative-import graph and collect the bare specifiers it
// reaches, so a stray React import in any other module fails the package check
// instead of surfacing as a missing-peer crash in a consumer that never opted
// in to React.
function reachedPackages(entryFile) {
  const seen = new Set();
  const packages = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/\b(?:from\s*|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g),
      ...source.matchAll(/^import\s+["']([^"']+)["']/gm),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) visit(path.resolve(path.dirname(file), specifier));
      else packages.add(specifier);
    }
  };
  visit(entryFile);
  return packages;
}

const reactFree = ["index", "world", "rng", "seed", "schedule", "eventLog", "traits/index"];
for (const entry of reactFree) {
  for (const built of [`dist/esm/${entry}.js`, `dist/cjs/${entry}.cjs`]) {
    const file = path.join(packageRoot, built);
    assert(existsSync(file), `${built} is missing`);
    const reached = [...reachedPackages(file)].filter(
      (name) => name === "react" || name.startsWith("react/") || name.startsWith("react-dom"),
    );
    assert.deepEqual(reached, [], `${built} must not reach React (found ${reached.join(", ")})`);
    assert(
      ![...reachedPackages(file)].includes("koota/react"),
      `${built} must not reach koota/react`,
    );
  }
}
assert(
  reachedPackages(path.join(packageRoot, "dist/esm/react.js")).has("react"),
  "dist/esm/react.js no longer imports react — the React-free check above is vacuous",
);

const consumerRoot = mkdtempSync(path.join(tmpdir(), "koota-kit-package-"));

try {
  const packOutput = execFileSync(
    npm,
    ["pack", "--pack-destination", consumerRoot, "--ignore-scripts", "--json"],
    { cwd: packageRoot, encoding: "utf8", env: npmEnvironment, shell: npmNeedsShell },
  );
  // Defend against any other lifecycle script (this package's or a
  // transitive one's) writing non-JSON text before/after the JSON array,
  // the same way the git-hook installer just did — a plain indexOf("[")
  // is not enough, since script output like "[INFO] ..." also starts
  // with "[". Parse from every "[" that opens a line until one succeeds.
  const jsonEnd = packOutput.lastIndexOf("]");
  assert(jsonEnd !== -1, `npm pack produced no JSON array:\n${packOutput}`);
  let pack;
  for (const match of packOutput.matchAll(/^\[/gm)) {
    try {
      [pack] = JSON.parse(packOutput.slice(match.index, jsonEnd + 1));
      break;
    } catch {
      // Not the real array start (e.g. a "[INFO] ..." line) — try the next "[".
    }
  }
  assert(pack, `npm pack did not return a parseable package manifest:\n${packOutput}`);

  const packedPaths = new Set(pack.files.map((file) => file.path));
  for (const required of [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "package.json",
    "docs/API.md",
    "docs/ARCHITECTURE.md",
    "docs/assets/koota-kit-hero.webp",
    "examples/basic.mjs",
    "examples/commonjs.cjs",
    "dist/esm/index.js",
    "dist/esm/index.d.ts",
    "dist/cjs/index.cjs",
    "dist/cjs/index.d.cts",
    "dist/esm/react.js",
    "dist/esm/react.d.ts",
    "dist/cjs/react.cjs",
    "dist/cjs/react.d.cts",
  ]) {
    assert(packedPaths.has(required), `packed artifact is missing ${required}`);
  }
  for (const forbiddenPrefix of ["src/", "tests/", "coverage/", "scripts/"]) {
    assert(
      [...packedPaths].every((file) => !file.startsWith(forbiddenPrefix)),
      `packed artifact unexpectedly contains ${forbiddenPrefix}`,
    );
  }

  const esm = await import(pathToFileURL(path.join(packageRoot, "dist/esm/index.js")).href);
  const require = createRequire(import.meta.url);
  const cjs = require(path.join(packageRoot, "dist/cjs/index.cjs"));
  const expectedRuntimeExports = [
    "advanceClock",
    "chance",
    "createActions",
    "createMasterSeed",
    "createRng",
    "createSimWorld",
    "createSubstreams",
    "defineEventLog",
    "defineTrait",
    "deriveSeed",
    "destroySimWorld",
    "getSubstream",
    "isMasterSeed",
    "nextFloat",
    "nextInt",
    "nextU32",
    "relation",
    "restoreLayers",
    "restoreStream",
    "restoreSubstreams",
    "restoreWorldHeader",
    "snapshotLayers",
    "snapshotStream",
    "snapshotSubstreams",
    "snapshotWorld",
    "substream",
    "trait",
  ];
  for (const name of expectedRuntimeExports) {
    assert.equal(typeof esm[name], "function", `ESM export ${name} is missing`);
    assert.equal(typeof cjs[name], "function", `CommonJS export ${name} is missing`);
  }

  const esmRng = esm.createRng({ gen: "package-check", events: 7 });
  const cjsRng = cjs.createRng({ gen: "package-check", events: 7 });
  assert.deepEqual(
    Array.from({ length: 8 }, () => esm.nextU32(esmRng.events)),
    Array.from({ length: 8 }, () => cjs.nextU32(cjsRng.events)),
    "ESM and CommonJS builds produced different deterministic output",
  );
  assert.equal(esm.MASTER_SEED_BYTES, 16, "ESM export MASTER_SEED_BYTES is wrong");
  assert.equal(cjs.MASTER_SEED_BYTES, 16, "CommonJS export MASTER_SEED_BYTES is wrong");
  const esmDerived = esm.deriveSeed("package-check", "round", 3);
  assert.equal(esmDerived, cjs.deriveSeed("package-check", "round", 3));
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) =>
      esm.nextU32(esm.substream(esmDerived, `s${index % 2}`)),
    ),
    Array.from({ length: 8 }, (_, index) =>
      cjs.nextU32(cjs.substream(esmDerived, `s${index % 2}`)),
    ),
    "ESM and CommonJS builds produced different substream output",
  );

  writeFileSync(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" })}\n`,
  );
  const tarball = path.join(consumerRoot, pack.filename);
  execFileSync(npm, ["install", "--no-audit", "--no-fund", tarball], {
    cwd: consumerRoot,
    env: npmEnvironment,
    shell: npmNeedsShell,
    stdio: "pipe",
  });
  const esmInstalledDraw = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import { createRng, nextU32 } from 'koota-kit'; " +
        "process.stdout.write(String(nextU32(createRng({ gen: 'g', events: 'e' }).events)));",
    ],
    { cwd: consumerRoot, encoding: "utf8" },
  );
  const cjsInstalledDraw = execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      "const { createRng, nextU32 } = require('koota-kit'); " +
        "process.stdout.write(String(nextU32(createRng({ gen: 'g', events: 'e' }).events)));",
    ],
    { cwd: consumerRoot, encoding: "utf8" },
  );
  assert.equal(esmInstalledDraw, cjsInstalledDraw, "installed ESM and CommonJS draws differ");

  // The React entry only works once the consumer opts in by installing React.
  // Install it now and render a provider through each module format.
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "react", "react-dom"], {
    cwd: consumerRoot,
    env: npmEnvironment,
    shell: npmNeedsShell,
    stdio: "pipe",
  });
  const reactProbe =
    "const { createSimWorld, destroySimWorld } = %ROOT%; " +
    "const { SimWorldProvider, useSimWorld } = %REACT%; " +
    "const { createElement } = %REACT_LIB%; " +
    "const { renderToStaticMarkup } = %SERVER%; " +
    "const handle = createSimWorld({ gen: 'g', events: 'e' }); " +
    "const Probe = () => createElement('i', null, String(useSimWorld() === handle)); " +
    "process.stdout.write(renderToStaticMarkup(" +
    "createElement(SimWorldProvider, { handle }, createElement(Probe)))); " +
    "destroySimWorld(handle);";
  const esmReactProbe = reactProbe
    .replace("%ROOT%", "await import('koota-kit')")
    .replace("%REACT%", "await import('koota-kit/react')")
    .replace("%REACT_LIB%", "await import('react')")
    .replace("%SERVER%", "await import('react-dom/server')");
  const cjsReactProbe = reactProbe
    .replace("%ROOT%", "require('koota-kit')")
    .replace("%REACT%", "require('koota-kit/react')")
    .replace("%REACT_LIB%", "require('react')")
    .replace("%SERVER%", "require('react-dom/server')");
  assert.equal(
    execFileSync(process.execPath, ["--input-type=module", "--eval", esmReactProbe], {
      cwd: consumerRoot,
      encoding: "utf8",
    }),
    "<i>true</i>",
    "installed ESM koota-kit/react did not provide the handle",
  );
  assert.equal(
    execFileSync(process.execPath, ["--input-type=commonjs", "--eval", cjsReactProbe], {
      cwd: consumerRoot,
      encoding: "utf8",
    }),
    "<i>true</i>",
    "installed CommonJS koota-kit/react did not provide the handle",
  );

  console.log(
    `koota-kit: installed ${pack.entryCount} intentional files; ESM and CommonJS APIs agree`,
  );
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
}
