#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const consumerRoot = mkdtempSync(path.join(tmpdir(), "koota-kit-package-"));

try {
  const packOutput = execFileSync(
    npm,
    ["pack", "--pack-destination", consumerRoot, "--ignore-scripts", "--json"],
    { cwd: packageRoot, encoding: "utf8", env: npmEnvironment, shell: npmNeedsShell },
  );
  // Defend against any other lifecycle script (this package's or a
  // transitive one's) writing non-JSON text before/after the JSON array,
  // the same way the git-hook installer just did.
  const jsonStart = packOutput.indexOf("[");
  const jsonEnd = packOutput.lastIndexOf("]");
  assert(jsonStart !== -1 && jsonEnd !== -1, `npm pack produced no JSON array:\n${packOutput}`);
  const [pack] = JSON.parse(packOutput.slice(jsonStart, jsonEnd + 1));
  assert(pack, "npm pack did not return a package manifest");

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
    "createRng",
    "createSimWorld",
    "defineEventLog",
    "defineTrait",
    "destroySimWorld",
    "nextFloat",
    "nextInt",
    "nextU32",
    "relation",
    "restoreLayers",
    "restoreStream",
    "restoreWorldHeader",
    "snapshotLayers",
    "snapshotStream",
    "snapshotWorld",
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
      "import { createRng, nextU32 } from '@jbdevprimary/koota-kit'; " +
        "process.stdout.write(String(nextU32(createRng({ gen: 'g', events: 'e' }).events)));",
    ],
    { cwd: consumerRoot, encoding: "utf8" },
  );
  const cjsInstalledDraw = execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      "const { createRng, nextU32 } = require('@jbdevprimary/koota-kit'); " +
        "process.stdout.write(String(nextU32(createRng({ gen: 'g', events: 'e' }).events)));",
    ],
    { cwd: consumerRoot, encoding: "utf8" },
  );
  assert.equal(esmInstalledDraw, cjsInstalledDraw, "installed ESM and CommonJS draws differ");

  console.log(
    `koota-kit: installed ${pack.entryCount} intentional files; ESM and CommonJS APIs agree`,
  );
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
}
