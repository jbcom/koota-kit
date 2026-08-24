#!/usr/bin/env node
// Minimal dual-format build: tsc emits ESM (+ .d.ts) and CJS (+ .d.cts)
// separately from two tsconfigs, no bundler. The CJS output's .js files are
// renamed to .cjs so Node resolves them as CommonJS regardless of the
// package's "type": "module", matching the package.json exports map.
//
// The CJS build emits its OWN declarations rather than reusing the ESM ones.
// Pointing a "require" condition at a .d.ts inside a "type": "module" package
// makes TypeScript read those types as ESM while the runtime file is CJS —
// arethetypeswrong reports this as "Masquerading as ESM", and a CommonJS
// consumer gets the wrong module shape for every export.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const tscBin = require.resolve("typescript/bin/tsc");

function run(args) {
  // Invoke TypeScript through the active Node executable instead of the
  // platform-specific node_modules/.bin shim (`tsc` vs `tsc.cmd`).
  execFileSync(process.execPath, [tscBin, ...args], { cwd: pkgRoot, stdio: "inherit" });
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, visit);
      continue;
    }
    visit(full, entry);
  }
}

// Order matters: .d.ts.map must be tested before .d.ts, and .d.ts before .js,
// or a shorter suffix claims a file the longer one owns.
const CJS_RENAMES = [
  [".d.ts.map", ".d.cts.map"],
  [".d.ts", ".d.cts"],
  [".js.map", ".cjs.map"],
  [".js", ".cjs"],
];

function renameForCjs(dir) {
  walk(dir, (full, entry) => {
    for (const [from, to] of CJS_RENAMES) {
      if (entry.endsWith(from)) {
        renameSync(full, full.slice(0, -from.length) + to);
        return;
      }
    }
  });
}

// tsc writes `require("./foo.js")`, `//# sourceMappingURL=foo.js.map` and
// `from "./foo.js"` in declarations regardless of the emitted file names —
// rewrite each to the .cjs/.d.cts names the files now actually have, since
// Node's CommonJS resolver and tsc both look for the literal extension named.
function fixCjsSpecifiers(dir) {
  walk(dir, (full, entry) => {
    if (entry.endsWith(".d.cts")) {
      const src = readFileSync(full, "utf8");
      const fixed = src
        .replace(/(from\s*|import\s*\()(["'])(\.[^"']+)\.js\2/g, "$1$2$3.cjs$2")
        .replace(/(\/\/#\s*sourceMappingURL=)(\S+)\.d\.ts\.map/g, "$1$2.d.cts.map");
      if (fixed !== src) writeFileSync(full, fixed);
      return;
    }
    if (entry.endsWith(".cjs")) {
      const src = readFileSync(full, "utf8");
      const fixed = src
        .replace(/require\((["'])(\.[^"']+)\.js\1\)/g, "require($1$2.cjs$1)")
        .replace(/(\/\/#\s*sourceMappingURL=)(\S+)\.js\.map/g, "$1$2.cjs.map");
      if (fixed !== src) writeFileSync(full, fixed);
    }
  });
}

rmSync(path.join(pkgRoot, "dist"), { recursive: true, force: true });

run(["-p", "tsconfig.esm.json"]);
run(["-p", "tsconfig.cjs.json"]);

const cjsDir = path.join(pkgRoot, "dist", "cjs");
renameForCjs(cjsDir);
fixCjsSpecifiers(cjsDir);

// A "type": "module" package makes Node treat a bare .d.ts/.js under dist/cjs
// as ESM. dist/cjs gets its own manifest so the whole directory is CommonJS.
writeFileSync(
  path.join(cjsDir, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

console.log("koota-kit: built dist/esm (ESM+types) and dist/cjs (CommonJS+types)");
