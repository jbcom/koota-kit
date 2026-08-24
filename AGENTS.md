# Agent notes

This file is for an autonomous coding agent working in this repository. It
covers what isn't obvious from reading the code alone.

## Toolchain

- Package manager: pnpm, pinned in `package.json#packageManager`. Use
  `mise install` (reads `mise.toml`) for a matching local Node/pnpm
  toolchain, or `corepack enable` if mise isn't available.
- This is a pnpm workspace with two members: `.` (the published library)
  and `docs/` (the private Sourcey documentation site). Root-level `pnpm`
  scripts operate on the library; `pnpm docs:*` scripts (`docs:dev`,
  `docs:build`, `docs:check`) delegate to `docs/` via
  `pnpm --filter koota-kit-docs`. Sourcey emits `docs/dist/`, including the
  site `llms.txt` and `llms-full.txt`; root `llms.txt` is separate, concise
  repository-agent orientation.
- `pnpm verify` is the single gate CI runs on the library: Biome lint,
  markdownlint on the published docs, strict TypeScript, the full test
  suite at 100% coverage thresholds, both dual-format builds, both
  runnable examples, `publint`, Are The Types Wrong, and a packed-tarball
  content/runtime check. A change is not done while any part of it is red.
  CI's `docs` job separately runs `pnpm docs:build`.

## Core invariants — do not violate these when editing `src/`

These are the reasons this package exists; breaking one reintroduces the bug
class it was built to prevent. Full detail in `docs/ARCHITECTURE.md`.

1. World-generation and runtime-event RNG draws never share a PRNG instance.
2. Invalid draw parameters (bad seeds, out-of-range bounds, non-finite
   probabilities) must not advance a stream — validate before drawing.
3. Object- and array-valued trait fields must go through a factory
   (`() => ({...})`), never a bare literal — `SafeSchema` and the runtime
   guard both reject bare object/array fields, and that rejection is the
   point, not a bug to work around.
4. Event logs have exactly one consuming owner. `drain` consumes and
   empties; `peek` returns a detached copy and never consumes. Don't add a
   second `drain`-style consumer to an existing log — publish a second log
   instead.
5. `snapshotWorld`/`restoreWorldHeader` only cover the clock and RNG
   streams. Do not extend them to serialize entities or traits — that
   boundary is intentional (see "Persistence boundary" in the README).
6. Restoring a header is atomic: validate the complete replacement before
   mutating the handle, never partially apply a restore.

## Keeping docs and tests in sync

A change to `src/*.ts`'s public surface needs matching updates in all of:

- `tests/*.test.ts` — the coverage gate is 100%, not "reasonable effort."
- `docs/API.md` and `docs/ARCHITECTURE.md` — these are the authored Sourcey
  pages and canonical API/architecture references; update architecture when a
  change crosses a module boundary or invariant. Do not create a second
  documentation renderer or a duplicate page tree.
- `README.md` — if the change affects the Quick start example or the
  "Why use it?" table.

## Commits and releases

- Conventional Commits only (`fix:`, `feat:`, `docs:`, `refactor:`,
  `test:`, `chore:`, …). A required CI check enforces conventional PR titles
  and Release Please parses the preserved merge-commit history to drive
  `CHANGELOG.md` and the next version. Never hand-edit the changelog or bump
  a version yourself.
- `pre-commit`, `simple-git-hooks`, `lint-staged`, and `commitlint` run locally on
  `pre-commit`/`commit-msg` after `pnpm install` (via the `prepare`
  script). They mirror what CI enforces; don't bypass them with
  `--no-verify` to save time — fix the input instead.
- The `main` branch ruleset requires every CI check to pass on the exact
  merge commit before a PR can merge; it deliberately does not require
  human review (this repo is agent-maintained), so don't treat an
  unreviewed PR as a signal that something was skipped.

## Files most likely to surprise you

- `pnpm-workspace.yaml`'s `allowBuilds` map (pnpm v11 syntax) controls
  which packages' install scripts run — `esbuild` and `sharp` are the only
  two currently allowed. A new dependency needing a native build step will
  silently no-op until it's added here.
- Sourcey paths in `docs/sourcey.config.ts` resolve relative to `docs/`.
  `pnpm docs:build` is the production check and builds the static Sourcey
  site; inspect `docs/dist/` for subdirectory-safe links before deployment.
