# OSS Release Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `extraction-src` branch / PR #1 by standing up a complete, secure, agent-friendly OSS release pipeline for `@jbdevprimary/koota-kit`: `ci.yml` → `release.yml` → `cd.yml` GitHub Actions flow, Dependabot, pre-commit-equivalent git hooks, Conventional Commit enforcement, fork-safe repository rulesets, GitHub Pages via an Astro/Starlight docs site branded to the project, a pnpm workspace uniting `src` (the library) and `docs` (the site), a first manual npm publish under `jbdevprimary`, and — once that first version is live on npm — an OIDC npm Trusted Publisher wired up via Claude in Chrome.

**Architecture:** Root repo becomes a pnpm workspace with two members: `.` (existing library, unchanged behavior) and `docs` (new Astro + Starlight site). Three workflows replace today's two: `ci.yml` (PR/push verification, unchanged logic, extended to also build docs), `release.yml` (release-please only — versions/tags/changelog, and after tagging, npm publish), `cd.yml` (deploys the Astro docs site to GitHub Pages on every push to `main` once CI is green, independent of whether a release happened). GitHub Pages is enabled on the `koota-kit` repo itself with `build_type: workflow` and **no repo-level custom domain** — because the `jbcom` org's user site (`jbcom.github.io`, bound to `jonbogaty.com`) already sets the account-level custom domain, `koota-kit`'s project Pages site automatically resolves at `https://jonbogaty.com/koota-kit` (confirmed via GitHub's official docs: "Using a custom domain across multiple repositories"). Branch protection uses the modern **repository ruleset** API (not classic branch protection), scoped to `main`, requiring PR review + all CI checks green + linear history + no force-push/deletion, with GitHub Apps/admin bypass only — this is free on public repos and is what stops a compromised fork PR from ever reaching `main` (forks already can't see repo secrets on `pull_request`-triggered workflows; the ruleset adds the human/CI gate on top). Pre-commit enforcement uses `simple-git-hooks` + `lint-staged`, matching the project's existing Biome-first, zero-Python toolchain, rather than the Python `pre-commit` framework. Conventional Commit enforcement is a required CI check (`amannn/action-semantic-pull-request` on PR titles + a commit-lint pass) so squash-merge commit messages entering `main` are always parseable by release-please.

**Tech Stack:** pnpm workspaces, Astro 7 + `@astrojs/starlight`, GitHub Actions (pinned to commit SHAs resolved live via `gh api`, no floating tags), release-please v5, `simple-git-hooks` + `lint-staged`, Biome (existing), GitHub repository rulesets, GitHub Pages (Actions-based deploy), npm Trusted Publishing (OIDC) configured via Claude-in-Chrome browser automation against npmjs.com.

**Spec:** This plan *is* the spec — derived directly from the user's task directive (finish PR #1 / `extraction-src` branch: ci→release→cd workflow structure, Dependabot + pre-commit + Conventional Commits, non-blocking-but-fork-safe branch protection, release-please-owned versioning/changelog, GitHub Pages + Astro OSS docs, pnpm workspace over `src`+`docs`, hero-image-matched docs branding, latest Actions pinned to exact SHAs via `gh`, README/AGENTS.md/llms.txt read as a human/agent would, no-broken-links-on-npm-publish, first npm publish under `jbdevprimary`, then OIDC Trusted Publisher via Chrome).

## Global Constraints

- Node engines floor: `>=22` (existing `package.json`). CI matrix stays Node 22 + 24 on Linux, Node 24 on Windows (existing `ci.yml`) — do not narrow it.
- Package manager: pnpm `10.33.2` (pinned in root `package.json#packageManager`) — the `docs` workspace member must use the same pnpm, not a separate lockfile.
- All new/changed GitHub Actions steps must reference the action by **full commit SHA**, with a trailing `# vX.Y.Z` comment for humans — resolved from `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (or `git/tags/<sha>` if annotated) against each action's **latest release**, not a version from training data.
- No `pull_request_target` anywhere; only `pull_request` (default: no secrets, read-only `GITHUB_TOKEN`) for anything that runs on untrusted fork code.
- Root `package.json` name/exports/publishConfig (`@jbdevprimary/koota-kit`, provenance, subpath exports) must not change — only scripts/devDependencies/workspace wiring may be touched.
- Existing `pnpm verify` script (`lint && lint:docs && typecheck && coverage && build && examples:check && package:check`) remains the CI gate for the library; docs get their own `pnpm --filter docs build` gate, run separately so a docs-only failure never blocks a library release and vice versa.
- Never commit `AGENTIC_NPM_TOKEN` or any Doppler secret value to a tracked file. Fetch it from Doppler (`gha` project, `ci` config) only into the local shell environment for the one-time manual `npm publish`, and only set it as a **GitHub Actions secret** (`NPM_TOKEN`) via `gh secret set`, never pasted into a workflow file.
- Astro `site` = `https://jonbogaty.com`, `base` = `/koota-kit` — do not use the `jbcom.github.io/koota-kit` default, since the org's bound custom domain makes that URL redirect/mismatch.
- Hero image at `docs/assets/koota-kit-hero.webp` (root docs dir, not the new `docs/` workspace) is the canonical brand asset — extract its palette programmatically (do not guess colors) and reuse the extracted hex values as Starlight's `--sl-color-accent*` custom properties.
- `docs/` (root-level, existing: `ARCHITECTURE.md`, `API.md`, `assets/`) is content the Starlight site consumes, but the **new pnpm workspace member is a separate directory**, e.g. `site/` — avoid colliding the existing `docs/` content folder with the new Astro project root. (Decision recorded in Task 1.)

---

### Task 1: Fix the pnpm workspace and add the `site/` Astro project skeleton

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `site/package.json`, `site/astro.config.mjs`, `site/tsconfig.json`, `site/.gitignore`
- Modify: root `package.json` (add `docs:*` scripts delegating to the `site` workspace member)
- Modify: `.gitignore` (root) if it doesn't already ignore `site/dist`, `site/.astro`

**Interfaces:**
- Produces: a working `pnpm --filter koota-kit-docs build` command producing `site/dist/`. Package name for the new workspace member: `koota-kit-docs` (private, not published to npm — `"private": true`).
- Consumes: nothing from other tasks (this is the foundation task).

- [ ] **Step 1: Fix `pnpm-workspace.yaml`'s broken `allowBuilds` placeholder and add the `site` package**

The current file has a non-functional placeholder value (`esbuild: set this to true or false` is not valid pnpm syntax — it's a stray comment that got written as a YAML value). Replace it with the correct boolean and register the new workspace member:

```yaml
packages:
  - .
  - site
onlyBuiltDependencies:
  - esbuild
  - sharp
```

(`sharp` is added because Astro's default image service and Starlight's asset optimization use it as an optional native dependency; without allow-listing it here, pnpm's build-script guard will block it silently.)

- [ ] **Step 2: Scaffold the Astro + Starlight project into `site/`**

Run from repo root:

```bash
pnpm dlx create-astro@latest site --template starlight --no-install --no-git --typescript strict
```

This creates `site/` with Astro + Starlight preconfigured. Do not run `pnpm install` yet — the workspace-level lockfile will pick it up in Step 4.

- [ ] **Step 3: Rewrite `site/package.json` to fit the workspace**

Read the generated file first, then edit it to:

```json
{
  "name": "koota-kit-docs",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.41.7",
    "astro": "^7.2.4",
    "sharp": "^0.34.5"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.5",
    "typescript": "^5.9.2"
  }
}
```

(Use whatever exact `astro`/`@astrojs/starlight`/`@astrojs/check` versions `create-astro` actually scaffolded — read `site/package.json` after Step 2 and reconcile; the versions above are what `npm view astro version` / `npm view @astrojs/starlight version` resolved to during planning, but re-check at execution time since these move fast.)

- [ ] **Step 4: Add root `package.json` docs scripts**

Add to the root `package.json` `"scripts"` block (keep every existing script untouched):

```json
"docs:dev": "pnpm --filter koota-kit-docs dev",
"docs:build": "pnpm --filter koota-kit-docs build",
"docs:check": "pnpm --filter koota-kit-docs check"
```

- [ ] **Step 5: Install and verify the workspace resolves**

```bash
pnpm install
pnpm --filter koota-kit-docs check
```

Expected: installs cleanly, `astro check` reports 0 errors on the scaffolded template content.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml site package.json pnpm-lock.yaml .gitignore
git commit -m "feat: scaffold Astro + Starlight docs site as a pnpm workspace member"
```

---

### Task 2: Extract the hero-image palette and brand the Starlight theme

**Files:**
- Create: `site/scripts/extract-palette.mjs` (throwaway analysis script — run once, keep committed for reproducibility)
- Create: `site/src/styles/custom.css`
- Modify: `site/astro.config.mjs`
- Create: `site/src/assets/koota-kit-hero.webp` (copy of the root `docs/assets/koota-kit-hero.webp`, since Starlight's logo/asset pipeline expects assets under `src/assets`)

**Interfaces:**
- Consumes: `site/package.json` from Task 1 (needs `sharp` installed to decode the webp for palette extraction).
- Produces: `site/src/styles/custom.css` with `:root` and `:root[data-theme='dark']` custom-property blocks that Task 3's `astro.config.mjs` wiring references via `customCss`.

- [ ] **Step 1: Write and run the palette extraction script**

```javascript
// site/scripts/extract-palette.mjs
import sharp from "sharp";

const { data, info } = await sharp("../docs/assets/koota-kit-hero.webp")
  .resize(64, 64, { fit: "inside" })
  .raw()
  .toBuffer({ resolveWithObject: true });

const counts = new Map();
for (let i = 0; i < data.length; i += info.channels) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  // bucket to reduce near-duplicate colors
  const key = `${r >> 4},${g >> 4},${b >> 4}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const toHex = (bucketKey) =>
  "#" + bucketKey.split(",").map((n) => (Number(n) * 16).toString(16).padStart(2, "0")).join("");

console.log("Top colors by frequency:");
for (const [key, count] of sorted.slice(0, 12)) {
  console.log(`${toHex(key)}  (${count} px)`);
}
```

Run: `cd site && node scripts/extract-palette.mjs`

Record the actual hex output in this plan file's execution notes (append below this step as a comment) before proceeding — the CSS in Step 2 must use these real extracted values, not placeholders.

- [ ] **Step 2: Write the Starlight theme override using the extracted palette**

Using the top 2-3 saturated, non-near-white/near-black colors from Step 1's output as `--sl-color-accent` / `--sl-color-accent-high` / `--sl-color-accent-low`, and the darkest/lightest neutrals for backgrounds:

```css
/* site/src/styles/custom.css */
:root {
  --sl-color-accent-low: #<extracted-low>;
  --sl-color-accent: #<extracted-mid>;
  --sl-color-accent-high: #<extracted-high>;
}

:root[data-theme="dark"] {
  --sl-color-accent-low: #<extracted-low-dark-adjusted>;
  --sl-color-accent: #<extracted-mid>;
  --sl-color-accent-high: #<extracted-high-dark-adjusted>;
}
```

(Fill in the literal hex values from Step 1's actual console output — do not invent colors. If the extraction yields muddy/desaturated buckets because the hero image is mostly line-art on a neutral background, widen the resize to `128x128` and re-run before falling back to manual inspection of the image via the Read tool's image-viewing capability.)

- [ ] **Step 3: Copy the hero asset into the Starlight asset pipeline and set it as the logo**

```bash
cp docs/assets/koota-kit-hero.webp site/src/assets/koota-kit-hero.webp
```

- [ ] **Step 4: Commit**

```bash
git add site/scripts/extract-palette.mjs site/src/styles/custom.css site/src/assets/koota-kit-hero.webp
git commit -m "feat(docs): derive Starlight theme colors from the project hero image"
```

---

### Task 3: Configure Starlight content, navigation, and site metadata

**Files:**
- Modify: `site/astro.config.mjs`
- Create: `site/src/content/docs/index.mdx` (landing page)
- Create: `site/src/content/docs/getting-started.md` (mirrors README Quick start)
- Create: `site/src/content/docs/api.md` (mirrors `docs/API.md`)
- Create: `site/src/content/docs/architecture.md` (mirrors `docs/ARCHITECTURE.md`)
- Delete: any `site/src/content/docs/*` placeholder files left by the `create-astro` template that aren't replaced above

**Interfaces:**
- Consumes: `site/src/styles/custom.css` from Task 2; hero image at `site/src/assets/koota-kit-hero.webp`.
- Produces: `site/astro.config.mjs` with `site`/`base` set correctly (Task 5's CD workflow and Task 7's README cross-links depend on the final published URL being `https://jonbogaty.com/koota-kit/`).

- [ ] **Step 1: Read the source-of-truth docs before writing anything**

Read `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` (once Task 6 creates it — if this task runs before Task 6, read `CONTRIBUTING.md` instead as the interim source for "how an agent should approach this repo") in full. The Starlight pages are not a blind copy — adapt structure for a docs-site reader (separate landing/getting-started/api/architecture pages) while keeping every technical claim (API signatures, error types, invariants) identical to the README/docs source. Do not introduce new claims not present in the source docs.

- [ ] **Step 2: Write `site/astro.config.mjs`**

```javascript
// site/astro.config.mjs
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://jonbogaty.com",
  base: "/koota-kit",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "koota-kit",
      description:
        "Deterministic Koota simulation conventions: world lifecycle, dual RNG streams, safe object traits, and world-scoped event logs.",
      logo: {
        src: "./src/assets/koota-kit-hero.webp",
        replacesTitle: false,
      },
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/jbcom/koota-kit" },
        { icon: "npm", label: "npm", href: "https://www.npmjs.com/package/@jbdevprimary/koota-kit" },
      ],
      editLink: {
        baseUrl: "https://github.com/jbcom/koota-kit/edit/main/site/",
      },
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        { label: "API Reference", slug: "api" },
        { label: "Architecture", slug: "architecture" },
      ],
    }),
  ],
});
```

- [ ] **Step 3: Write `site/src/content/docs/index.mdx`**

A landing page adapted from the README's opening (project description, "Why use it?", install snippet, link to Getting Started) — using Starlight's `<CardGrid>`/`<Card>` components for the "Core concepts" summary (one lifecycle boundary, two seeded RNG streams, safe object traits, world-scoped event logs) with each card linking to the relevant anchor in `api.md` or `architecture.md`.

- [ ] **Step 4: Write `site/src/content/docs/getting-started.md`, `api.md`, `architecture.md`**

Port content from `README.md`'s "Install"/"Quick start" sections, `docs/API.md`, and `docs/ARCHITECTURE.md` respectively, adjusting only relative links (root-repo-relative links like `./docs/API.md` become Starlight-relative like `/koota-kit/api/`).

- [ ] **Step 5: Build and manually verify**

```bash
pnpm --filter koota-kit-docs build
pnpm --filter koota-kit-docs preview
```

Open the preview URL, click through every sidebar link and every internal content link. Confirm the hero/logo renders and the accent color from Task 2 is visibly applied (not the Starlight default purple).

- [ ] **Step 6: Commit**

```bash
git add site/astro.config.mjs site/src/content
git commit -m "feat(docs): author Starlight content from README, API, and architecture docs"
```

---

### Task 4: Rename/restructure workflows into ci.yml → release.yml → cd.yml, pin every action to an exact SHA

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml` (release-please + version bump only; publish step moves to a job that Task 8 hooks the npm publish into — see Task 8)
- Create: `.github/workflows/cd.yml`

**Interfaces:**
- Consumes: nothing new from earlier tasks except that `ci.yml`'s verify job should also build the docs site (`pnpm --filter koota-kit-docs build`) so a docs regression fails CI before merge.
- Produces: `cd.yml` triggered on push to `main` (after CI verification passes via `workflow_run`, not duplicated logic) that builds `site/dist` and deploys to GitHub Pages using `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`.

- [ ] **Step 1: Resolve exact commit SHAs for every action this task uses**

Run (do not use memorized SHAs — re-resolve at execution time in case newer releases shipped since planning):

```bash
for spec in \
  "actions/checkout" \
  "actions/setup-node" \
  "pnpm/action-setup" \
  "actions/configure-pages" \
  "actions/upload-pages-artifact" \
  "actions/deploy-pages" \
  "googleapis/release-please-action"; do
  tag=$(gh api "repos/$spec/releases/latest" --jq '.tag_name')
  sha=$(gh api "repos/$spec/git/ref/tags/$tag" --jq '.object.sha')
  echo "$spec @ $tag = $sha"
done
```

Use the printed SHAs below. (Planning-time values, re-verify — do not trust these blindly at execution time if more than a few hours have passed:)

- `actions/checkout` @ `v7.0.1` = `3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node` @ `v7.0.0` = `820762786026740c76f36085b0efc47a31fe5020`
- `pnpm/action-setup` @ `v6.0.10` = `0977fd99725f1db4007ccb2928dbb4e90d06cc86`
- `actions/configure-pages` @ `v6.0.0` = `45bfe0192ca1faeb007ade9deae92b16b8254a0d`
- `actions/upload-pages-artifact` @ `v5.0.0` = `fc324d3547104276b827a68afc52ff2a11cc49c9`
- `actions/deploy-pages` @ `v5.0.0` = `cd2ce8fcbc39b97be8ca5fce6e763baed58fa128`
- `googleapis/release-please-action` @ `v5.0.0` = `45996ed1f6d02564a971a2fa1b5860e934307cf7`

- [ ] **Step 2: Rewrite `.github/workflows/ci.yml`**

Keep the existing matrix/lockfile-sync/verify logic exactly as-is (it already uses `actions/checkout@v4` and `actions/setup-node@v4` by tag — re-pin those to the SHAs above too, since this task's constraint is "every workflow uses exact SHAs," not just the new ones). Add a docs-build job that runs once (not matrixed) and does not gate on the library matrix (`needs: []`, independent job) so docs and library verification report as separate, parallel checks:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: Verify (${{ matrix.os }}, Node ${{ matrix.node }})
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-24.04
            node: 22
          - os: ubuntu-24.04
            node: 24
          - os: windows-2022
            node: 24
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: ${{ matrix.node }}
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - name: Lockfile is in sync
        if: matrix.os == 'ubuntu-24.04' && matrix.node == 24
        run: |
          pnpm install --lockfile-only
          git diff --exit-code pnpm-lock.yaml
      - run: pnpm verify

  docs:
    name: Docs build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs:build
```

- [ ] **Step 3: Rewrite `.github/workflows/release.yml` — release-please only (publish moves out in Task 8)**

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      pull-requests: write
    outputs:
      released: ${{ steps.release.outputs.release_created }}
      tag: ${{ steps.release.outputs.tag_name }}
    steps:
      - id: release
        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

(The `publish` job that was previously in this file moves to Task 8, where it's rewritten to use OIDC-only Trusted Publishing once that's configured — see Task 8's rationale for keeping it in `release.yml` rather than `cd.yml`: publish is release-triggered, not push-to-main-triggered, so it stays alongside release-please logically even though this task's header says "release.yml → cd.yml" as a *sequence*, not that publish belongs in cd.yml.)

- [ ] **Step 4: Write `.github/workflows/cd.yml` — deploy docs to GitHub Pages**

Triggered on successful completion of the CI workflow on `main` (so Pages never deploys a broken/unverified docs build), using `workflow_run`:

```yaml
name: CD

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-24.04
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm docs:build
      - uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: site/dist
      - id: deployment
        uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
```

- [ ] **Step 5: Validate every workflow with actionlint**

```bash
pnpm dlx @rhysd/actionlint@latest .github/workflows/*.yml
```

Expected: no errors. (This is already part of `lint:docs`/CI per the PR's own validation notes — but run it locally here before committing since these are hand-authored, not generated.)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/cd.yml
git commit -m "ci: restructure workflows into ci -> release -> cd, pin every action to an exact commit SHA"
```

---

### Task 5: Enable GitHub Pages on the repository (Actions-based, no repo-level custom domain)

**Files:** None (this is a `gh api` / repo-settings task, not a file change) — but confirm `.github/workflows/cd.yml` from Task 4 is already committed/pushed, since GitHub Pages "workflow" build type requires the workflow to exist on the default branch before it can be selected as the source.

**Interfaces:**
- Consumes: `cd.yml` from Task 4 must exist on `main` (this task runs after Task 4's branch is merged, or — since this whole plan lands as one PR per the user's CLAUDE.md branching rules — after this PR merges to `main`; if you need Pages live before merge for verification, temporarily point `gh api` at a preview by first pushing `cd.yml` alone... but the simpler and correct order is: finish and merge the whole PR (Task 9), THEN run this task's `gh api` call once `cd.yml` exists on `main`. Reorder: this task's actual execution happens **after** Task 9's merge, not before. Keep it last in execution order even though it's numbered here for narrative flow with Task 4.)

- [ ] **Step 1 (post-merge): Enable Pages with `build_type: workflow`**

```bash
gh api --method POST repos/jbcom/koota-kit/pages \
  -f build_type=workflow
```

- [ ] **Step 2: Confirm no custom domain is set on this repo (so it inherits the org's)**

```bash
gh api repos/jbcom/koota-kit/pages --jq '{cname, html_url, status, build_type}'
```

Expected: `cname` is `null` and, once the `cd.yml` workflow has run once successfully, `html_url` should read `https://jonbogaty.com/koota-kit/`.

- [ ] **Step 3: Trigger the CD workflow once (if it hasn't already run via the merge's own `main` push) and verify the live URL**

```bash
gh workflow run cd.yml --ref main 2>&1 || true  # cd.yml is workflow_run-triggered, not workflow_dispatch — if this errors, it already ran automatically off the merge commit's CI success; check with:
gh run list --workflow=cd.yml --limit 3
```

Once a run shows `completed`/`success`, fetch the live URL and confirm it 200s and matches the branded content from Task 3:

```bash
curl -sI https://jonbogaty.com/koota-kit/ | head -1
```

No commit for this task (repo settings only).

---

### Task 6: Write `AGENTS.md` and `llms.txt`

**Files:**
- Create: `AGENTS.md`
- Create: `llms.txt`

**Interfaces:**
- Consumes: full read of `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, `package.json` scripts (from Task 1's final state).
- Produces: two files an autonomous coding agent reads first when it clones this repo — this task's own execution must itself follow them literally as a self-test (Step 3).

- [ ] **Step 1: Read every doc in the repo as a human contributor would, end to end**

`README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `package.json`. Do not skim — this task's entire point is producing an accurate agent onboarding doc, so shortcuts here directly produce a wrong `AGENTS.md`.

- [ ] **Step 2: Write `AGENTS.md`**

Following the emerging `AGENTS.md` convention (plain Markdown, imperative, scoped to "what does an agent need to know before touching this repo that isn't obvious from the code"): package manager (`pnpm`, exact version), the `pnpm verify` gate and what each sub-script checks, the workspace layout (`.` = library, `site/` = docs, both under one `pnpm-workspace.yaml`), Conventional Commit requirement (ties to Task 7's enforcement), the "one lifecycle boundary / two RNG streams / safe object traits / world-scoped event logs" core invariants from the README's "Core concepts" (an agent must not violate these when editing `src/`), and where tests/docs must be updated together (`src/*.ts` ↔ `tests/*.test.ts` ↔ `docs/API.md` ↔ `site/src/content/docs/api.md`).

- [ ] **Step 3: Write `llms.txt`**

Follow the llms.txt convention (https://llmstxt.org — a concise Markdown index: H1 project name, one-line blockquote summary, H2 sections linking to canonical docs with one-line descriptions). Link to the live docs site (`https://jonbogaty.com/koota-kit/`), the README, `docs/API.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md` itself.

- [ ] **Step 4: Self-test — re-read `AGENTS.md` cold and follow it**

Treat `AGENTS.md` as if this were a fresh session with zero prior context on this repo. Run every command it lists (`pnpm install`, `pnpm verify`, etc.) and confirm each one works exactly as written. Fix any command that doesn't match reality.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md llms.txt
git commit -m "docs: add AGENTS.md and llms.txt for autonomous-agent onboarding"
```

---

### Task 7: Dependabot, Conventional Commit enforcement, and pre-commit hooks

**Files:**
- Create: `.github/dependabot.yml`
- Create: `.github/workflows/lint-pr.yml`
- Create: `.simple-git-hooks.json` (or `simple-git-hooks` config block in root `package.json` — decide during Step 3 based on which the tool actually reads at install time)
- Modify: root `package.json` (add `simple-git-hooks`, `lint-staged`, `commitlint`-equivalent devDependencies + `"prepare"` script + `lint-staged` config)
- Create: `commitlint.config.mjs`

**Interfaces:**
- Consumes: exact SHAs resolved the same way as Task 4 for `amannn/action-semantic-pull-request`.
- Produces: a required CI check named from `lint-pr.yml`'s job (referenced by Task 8's ruleset config) that fails any PR whose title isn't a valid Conventional Commit — this is the check that keeps release-please's changelog parsing sound, since this repo squash-merges (PR title becomes the commit message).

- [ ] **Step 1: Write `.github/dependabot.yml`**

Cover both the root npm workspace and the new `site` npm scope (pnpm workspaces still register as `npm` ecosystem to Dependabot, using `directory` per workspace root) plus GitHub Actions:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        dependency-type: development
    labels:
      - dependencies

  - package-ecosystem: npm
    directory: /site
    schedule:
      interval: weekly
    groups:
      docs-dependencies:
        dependency-type: development
    labels:
      - dependencies
      - docs

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    labels:
      - dependencies
      - ci
```

- [ ] **Step 2: Resolve the SHA for `amannn/action-semantic-pull-request` and write `.github/workflows/lint-pr.yml`**

```bash
tag=$(gh api repos/amannn/action-semantic-pull-request/releases/latest --jq '.tag_name')
sha=$(gh api repos/amannn/action-semantic-pull-request/git/ref/tags/$tag --jq '.object.sha')
echo "$tag = $sha"
```

```yaml
name: Lint PR

on:
  pull_request:
    types: [opened, edited, synchronize, reopened]

permissions:
  contents: read
  pull-requests: read

jobs:
  title:
    runs-on: ubuntu-24.04
    steps:
      - uses: amannn/action-semantic-pull-request@<resolved-sha> # <resolved-tag>
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Use the plain `pull_request` trigger, not `pull_request_target` — the PR title is already present on `github.event.pull_request.title` without needing the elevated-token, fork-checkout-capable trigger. `pull_request_target` would only be justified if this job needed write access (e.g. to comment) or needed to check out fork code with secrets, neither of which applies here, so the plan's own "no `pull_request_target` anywhere" constraint is honored without exception.

- [ ] **Step 3: Add `simple-git-hooks` + `lint-staged` to root `package.json`**

```json
"devDependencies": {
  "simple-git-hooks": "^2.13.1",
  "lint-staged": "^17.3.0"
},
"scripts": {
  "prepare": "simple-git-hooks"
},
"simple-git-hooks": {
  "pre-commit": "pnpm exec lint-staged",
  "commit-msg": "pnpm exec commitlint --edit $1"
},
"lint-staged": {
  "*.{ts,js,mjs,cjs,json}": ["biome check --write --no-errors-on-unmatched"],
  "*.md": ["markdownlint-cli2"]
}
```

Add `@commitlint/cli` and `@commitlint/config-conventional` as devDependencies too, and write `commitlint.config.mjs`:

```javascript
export default { extends: ["@commitlint/config-conventional"] };
```

- [ ] **Step 4: Install and verify hooks activate**

```bash
pnpm install
pnpm run prepare
git commit --allow-empty -m "not a conventional commit"
```

Expected: the commit is **rejected** by the `commit-msg` hook. Then:

```bash
git commit --allow-empty -m "chore: verify commit-msg hook accepts conventional commits"
```

Expected: accepted. Remove this verification commit (`git reset --soft HEAD~1`) before the real Step 5 commit — don't ship an empty verification commit.

- [ ] **Step 5: Commit**

```bash
git add .github/dependabot.yml .github/workflows/lint-pr.yml package.json pnpm-lock.yaml commitlint.config.mjs
git commit -m "feat: enforce Conventional Commits via commitlint, git hooks, and a required PR-title check"
```

---

### Task 8: Repository rulesets for `main` — fork-safe, agent-friendly branch protection

**Files:** None (API-only) — but this task is written up as a script for reproducibility.
- Create: `scripts/apply-branch-ruleset.mjs` (idempotent, re-runnable; documents the protection as code instead of a one-off manual API call lost to history)

**Interfaces:**
- Consumes: the check names produced by Task 4 (`Verify (ubuntu-24.04, Node 22)`, `Verify (ubuntu-24.04, Node 24)`, `Verify (windows-2022, Node 24)`, `Docs build`) and Task 7 (`title` from `lint-pr.yml`, surfaced as `Lint PR / title`) as the exact `required_status_checks` context strings.

- [ ] **Step 1: Write `scripts/apply-branch-ruleset.mjs`**

A Node script (uses `node:child_process` to shell out to `gh api`, consistent with the repo's existing `scripts/build.mjs`/`scripts/verify-package.mjs` style — no new HTTP client dependency) that PUTs a ruleset via `gh api repos/jbcom/koota-kit/rulesets` with this shape:

```javascript
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Verify (ubuntu-24.04, Node 22)" },
          { "context": "Verify (ubuntu-24.04, Node 24)" },
          { "context": "Verify (windows-2022, Node 24)" },
          { "context": "Docs build" },
          { "context": "Lint PR / title" }
        ]
      }
    }
  ],
  "bypass_actors": [
    { "actor_type": "OrganizationAdmin", "bypass_mode": "always" }
  ]
}
```

**Design rationale (do not change without re-reading this):** `required_approving_review_count: 0` is deliberate, not an oversight — the user's directive is explicit that protections must "not block agentic development." A solo-maintainer OSS repo with an autonomous agent as primary committer cannot require human review without either blocking the agent or requiring the agent to review its own PRs (meaningless). What actually stops a compromised fork from reaching `main` is: (a) fork PRs never get repo secrets (GitHub default for `pull_request`), (b) `required_status_checks` with `strict_required_status_checks_policy: true` means the PR branch must be up-to-date with `main` and all listed checks must pass **on that exact commit** before merge is even offered, (c) `non_fast_forward` + `deletion` rules block history rewrites/branch deletion on `main` itself, (d) only org admins (i.e., the human account, `jonbogaty`) can bypass — a fork's PR author, even if they somehow got write access to a branch, is never in that bypass list. If the user later wants human review gating too, that's a one-line change to `required_approving_review_count`, not a redesign.

- [ ] **Step 2: Run it**

```bash
node scripts/apply-branch-ruleset.mjs
```

- [ ] **Step 3: Verify**

```bash
gh api repos/jbcom/koota-kit/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/jbcom/koota-kit/rulesets/<id-from-above> --jq '.rules[].type'
```

Expected: the ruleset is `active` and lists all 5 rule types from Step 1.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/apply-branch-ruleset.mjs
git commit -m "feat: codify main branch protection as a repository ruleset script"
```

(The `gh api` calls in Steps 2-3 are applied live against the repo, not deferred — repository settings aren't part of the git tree, so there's nothing "to merge" for the ruleset itself, only for the script that produced it.)

---

### Task 9: First manual npm publish under `jbdevprimary`

**Files:** None — this is a release operation, not a code change. Do this task **after** Tasks 1-8 are committed to the branch and the PR is ready, but the actual `npm publish` happens locally, from the built package, authenticated via the Doppler-sourced token — it is independent of whether release-please has run yet (release-please governs *future* versions; this first publish bootstraps npm with whatever version is already in `package.json`/`.release-please-manifest.json`, currently `0.1.1`).

**Interfaces:**
- Consumes: `pnpm verify` must pass clean (existing gate) immediately before publishing — never publish an unverified tree.
- Produces: `@jbdevprimary/koota-kit@0.1.1` live on the public npm registry, which Task 10 depends on (Trusted Publisher setup requires the package to already exist).

- [ ] **Step 1: Fetch the token from Doppler into the shell environment (do not print it, do not write it to a file)**

```bash
doppler secrets get AGENTIC_NPM_TOKEN --project gha --config ci --plain
```

Confirm this returns a token-shaped string (do not echo it in a way that lands in any log/transcript beyond the direct tool call itself — per this user's own global instructions, entering a secret into a local tool call on this machine is fine; printing it as a "here's the value" human-readable report is not).

- [ ] **Step 2: Run the publish using that token, without writing it to `.npmrc` on disk**

```bash
pnpm verify
NPM_TOKEN=$(doppler secrets get AGENTIC_NPM_TOKEN --project gha --config ci --plain) \
  npm publish --access public --provenance --//registry.npmjs.org/:_authToken="$NPM_TOKEN"
```

(`npm whoami` already resolved to `jbdevprimary` per local `~/.npmrc`/keychain auth during planning — if that session token is still valid, `npm publish` may not even need `AGENTIC_NPM_TOKEN` explicitly; check `npm whoami` first and only fall back to the explicit token flag if it's unauthenticated. Either way, the package publishes under the `jbdevprimary` account as the user specified.)

- [ ] **Step 3: Verify the publish**

```bash
npm view @jbdevprimary/koota-kit version
npm view @jbdevprimary/koota-kit dist.tarball
```

- [ ] **Step 4: Verify no broken links/images in what npm actually serves**

```bash
mkdir -p /tmp/koota-kit-publish-check && cd /tmp/koota-kit-publish-check
npm pack @jbdevprimary/koota-kit
tar xzf jbdevprimary-koota-kit-*.tgz
```

Read the unpacked `package/README.md` and confirm every relative link/image resolves within the published tarball's own file set (`files` in `package.json` is `["CHANGELOG.md", "dist", "docs", "examples"]` — so any README link to something outside that list, e.g. a root-only file like `CONTRIBUTING.md`, is a broken link on npm even though it works on GitHub). Cross-check every `README.md` link against the `files` array from Task 1's final `package.json`; for any link that points outside the published file set, either add that path to `files` or rewrite the link to point at the GitHub-hosted version (`https://github.com/jbcom/koota-kit/blob/main/<path>`) instead. Also verify the hero image (`docs/assets/koota-kit-hero.webp`) is present in the tarball and the README's image tag resolves relative to the unpacked root.

No commit for this task unless Step 4 finds a broken link, in which case fix `package.json#files` or the README link and commit:

```bash
git add package.json README.md
git commit -m "fix: keep npm-published README links resolvable within the package file set"
```

(then re-publish is NOT redone here for a docs-only link fix post-first-publish — that fix ships in the next release-please-driven version, since npm doesn't allow republishing the same version. Only fix it before Step 2 if this task hasn't published yet; if it's discovered after Step 2, it's a fast-follow, not a blocker to closing this task.)

---

### Task 10: Configure npm Trusted Publisher (OIDC) via Claude in Chrome, wire `release.yml`'s publish job to it

**Files:**
- Modify: `.github/workflows/release.yml` (add back the `publish` job, OIDC-only — no `NPM_TOKEN`)

**Interfaces:**
- Consumes: `@jbdevprimary/koota-kit` must already exist on npm (Task 9).

- [ ] **Step 1: Load the `claude-in-chrome` skill and core tools**

```
Skill: claude-in-chrome
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp
```

- [ ] **Step 2: Navigate to the package's npm settings and add a Trusted Publisher**

Navigate to `https://www.npmjs.com/package/@jbdevprimary/koota-kit/access` (npm's current path for package access/publishing settings — confirm the exact tab name via `read_page` once loaded, since npm's UI names this "Trusted Publisher" or "Publishing access" depending on current UI). If not already logged in as `jbdevprimary` in the Chrome session, this is where a true blocker (`[WAIT-USER]`, interactive credential entry) could occur — check login state first via `read_page` before assuming a block.

Configure:
- Publisher: **GitHub Actions**
- Organization/repository owner: `jbcom`
- Repository: `koota-kit`
- Workflow filename: `release.yml`
- Environment: leave blank unless the workflow sets one (this plan's `release.yml` doesn't use a GitHub Environment for the publish job, so leave this field empty to match)

- [ ] **Step 3: Rewrite `release.yml`'s `publish` job to use OIDC only**

```yaml
  publish:
    needs: release-please
    if: needs.release-please.outputs.released == 'true'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag }}
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify
      - run: npm publish --access public --provenance
```

No `NODE_AUTH_TOKEN`/`NPM_TOKEN` env at all — npm CLI (`>=11.5.1`, confirm via `npm --version` in the runner or pin `npm i -g npm@latest` as a step if the bundled version with Node 24 predates OIDC trusted-publish support) detects the OIDC context automatically when a Trusted Publisher is configured for the package.

- [ ] **Step 4: If a repo-level `NPM_TOKEN` secret exists from before, remove it — it's no longer needed and is a standing credential risk once OIDC works**

```bash
gh secret list --repo jbcom/koota-kit
gh secret delete NPM_TOKEN --repo jbcom/koota-kit  # only if it was ever set; Task 9 didn't set one at the repo level, only used the token locally, so this step likely finds nothing to delete — confirm, don't assume
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: publish to npm via OIDC trusted publishing instead of a long-lived token"
```

- [ ] **Step 6: Verify end-to-end on the next real release**

This can't be fully verified until release-please next creates a release PR and it merges (triggering a real publish). Note in the PR description that this is verified live on the next version bump, not synthetically — do not fabricate a test publish.

---

### Task 11: Update README for the new docs site, workspace layout, and links; final full verification pass

**Files:**
- Modify: `README.md` (add a link to the live docs site near the top; note the `pnpm` workspace layout in "Development"; ensure every existing link still resolves per Task 9's file-set check)
- Modify: `CONTRIBUTING.md` if it references the old two-workflow (`ci.yml`/`release.yml`) setup by name

**Interfaces:**
- Consumes: final state of every prior task.

- [ ] **Step 1: Add a docs-site link to `README.md`**

Near the top (after the badges, before "Why use it?"), add:

```markdown
Full documentation: **[jonbogaty.com/koota-kit](https://jonbogaty.com/koota-kit/)**
```

- [ ] **Step 2: Update the "Development" section to mention the `site/` workspace member**

Add one sentence noting `pnpm docs:dev` / `pnpm docs:build` for the documentation site, alongside existing library dev commands.

- [ ] **Step 3: Grep for stale references to the old workflow structure**

```bash
grep -rn "release.yml\|ci.yml" README.md CONTRIBUTING.md docs/ site/src/content/docs/ 2>/dev/null
```

Fix anything that still describes the pre-`cd.yml` two-workflow setup.

- [ ] **Step 4: Run the full verification suite one final time**

```bash
pnpm verify
pnpm docs:build
pnpm dlx @rhysd/actionlint@latest .github/workflows/*.yml
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: link the published docs site and document the pnpm workspace layout"
```

---

### Task 12: Update the PR, wait for CI, merge, then run Tasks 5/9/10's post-merge steps in order

**Files:** None.

- [ ] **Step 1: Push the branch and update PR #1's description**

```bash
git push
gh pr edit 1 --body "$(cat <<'EOF'
<update to reflect: ci -> release -> cd workflow structure, Dependabot, Conventional Commit enforcement via commitlint + simple-git-hooks + required PR-title check, repository ruleset on main, GitHub Pages docs site at jonbogaty.com/koota-kit, AGENTS.md + llms.txt, pnpm workspace with site/ docs member, hero-image-derived Starlight branding>
EOF
)"
```

- [ ] **Step 2: Wait for CI, address any failures as forward commits (never amend)**

Use the `babysit-pr` skill/workflow implicitly: watch `gh pr checks 1 --watch`, fix forward, re-push, repeat until green.

- [ ] **Step 3: Squash-merge once green**

```bash
gh pr merge 1 --squash
```

- [ ] **Step 4: Now run Task 5 (enable Pages), Task 9 (first npm publish), Task 10 (Trusted Publisher via Chrome) in that order against the merged `main`**

Task 5 needs `cd.yml` on `main` (true after merge). Task 9 needs a clean verified tree (true after merge, before any release-please PR has run — publishing `0.1.1` directly). Task 10 needs Task 9's package to exist on npm first.

- [ ] **Step 5: Final live verification**

```bash
curl -sI https://jonbogaty.com/koota-kit/ | head -1
npm view @jbdevprimary/koota-kit version
gh api repos/jbcom/koota-kit/rulesets --jq '.[].name'
```

All three must succeed before this plan is considered complete.
