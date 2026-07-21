#!/usr/bin/env node
// Minimal dual-format build: tsc emits ESM (+ .d.ts) and CJS separately from
// two tsconfigs, no bundler. The CJS output's .js files are renamed to .cjs
// so Node resolves them as CommonJS regardless of the package's "type":
// "module", matching the package.json exports map.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tscBin = path.join(pkgRoot, 'node_modules', '.bin', 'tsc');

function run(args) {
  execFileSync(tscBin, args, { cwd: pkgRoot, stdio: 'inherit' });
}

function renameJsToCjs(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      renameJsToCjs(full);
      continue;
    }
    if (entry.endsWith('.js')) {
      renameSync(full, full.replace(/\.js$/, '.cjs'));
    } else if (entry.endsWith('.js.map')) {
      renameSync(full, full.replace(/\.js\.map$/, '.cjs.map'));
    }
  }
}

// tsc emits `require("./foo.js")` regardless of module target — rewrite
// the renamed .cjs files' own require() specifiers to match, since Node's
// CommonJS resolver looks for the literal extension named in the call.
function fixCjsRequireExtensions(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      fixCjsRequireExtensions(full);
      continue;
    }
    if (!entry.endsWith('.cjs')) continue;
    const src = readFileSync(full, 'utf8');
    const fixed = src.replace(/require\((["'])(\.[^"']+)\.js\1\)/g, 'require($1$2.cjs$1)');
    if (fixed !== src) writeFileSync(full, fixed);
  }
}

rmSync(path.join(pkgRoot, 'dist'), { recursive: true, force: true });

run(['-p', 'tsconfig.esm.json']);
run(['-p', 'tsconfig.cjs.json']);

renameJsToCjs(path.join(pkgRoot, 'dist', 'cjs'));
fixCjsRequireExtensions(path.join(pkgRoot, 'dist', 'cjs'));

console.log('ecs-koota: built dist/esm (ESM+types) and dist/cjs (CommonJS)');
