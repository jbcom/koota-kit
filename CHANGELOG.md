# Changelog

## [0.2.0](https://github.com/jbcom/koota-kit/compare/v0.1.1...v0.2.0) (2026-08-24)


### Features

* codify main branch protection as a repository ruleset script ([30cda81](https://github.com/jbcom/koota-kit/commit/30cda819de657fade54157d492b77acab4192975))
* **docs:** author Starlight content from README, API, and architecture docs ([9809dc2](https://github.com/jbcom/koota-kit/commit/9809dc20904b26b0735a5e79caa9b256377c4810))
* **docs:** derive Starlight theme colors from the project hero image ([4953770](https://github.com/jbcom/koota-kit/commit/4953770e6bd6d199bdc7e74d427304d9e85a4875))
* **ecs-koota:** extract koota ECS conventions to @arcade-cabinet/ecs-koota ([#1](https://github.com/jbcom/koota-kit/issues/1)) ([3194046](https://github.com/jbcom/koota-kit/commit/319404639256c90bedb6cf69871dfe25fac0b5e8))
* **ecs-koota:** extract scratch-backed event logs with a peek seam ([#4](https://github.com/jbcom/koota-kit/issues/4)) ([746a8b9](https://github.com/jbcom/koota-kit/commit/746a8b9f0fe189fc60fddc23c35059d365fbe19c))
* enforce Conventional Commits via commitlint, git hooks, and a required PR-title check ([9afb14a](https://github.com/jbcom/koota-kit/commit/9afb14a4b6d0836a80ed38fa4f898ef266aca3df))
* harden koota-kit for public release ([2fa3568](https://github.com/jbcom/koota-kit/commit/2fa3568e708b816218706596a3593318ba31a28c))
* harden koota-kit for public release ([13363c1](https://github.com/jbcom/koota-kit/commit/13363c1d7ff1e8eabd7ba830f91ea75ab2134637))
* migrate docs to Sourcey and harden delivery ([9e876f1](https://github.com/jbcom/koota-kit/commit/9e876f1f7082bf142baf9b38bc4133dd565e145b))
* scaffold Astro + Starlight docs site as a pnpm workspace member ([bb12bc0](https://github.com/jbcom/koota-kit/commit/bb12bc08bf3493a4b4832d520b249b984a340f1d))


### Bug Fixes

* address CodeRabbit review findings ([98e8431](https://github.com/jbcom/koota-kit/commit/98e84312c9c90ff11f1b61988e134d23c253fcea))
* **ci:** accept release-please changelog layout ([8b08654](https://github.com/jbcom/koota-kit/commit/8b086549c40a1e41ba84b41642a1590ba19377f9))
* **ci:** accept release-please changelog layout ([4e7a329](https://github.com/jbcom/koota-kit/commit/4e7a3291edf07d717096ed69d712c9d9b3e331ea))
* **ci:** allow release validation dispatch ([e51eff0](https://github.com/jbcom/koota-kit/commit/e51eff03a57e62d26b69c487c6de2b791c727a25))
* **ci:** allow release validation dispatch ([3601162](https://github.com/jbcom/koota-kit/commit/36011625cff3685fa268bdbb8c856643f6ccdf8f))
* **ci:** dispatch release policy gates ([eac0ad7](https://github.com/jbcom/koota-kit/commit/eac0ad7fb459fd56a8a1bfc8a4f6a587edc4ec70))
* **ci:** dispatch release policy gates ([dd4f9f3](https://github.com/jbcom/koota-kit/commit/dd4f9f3603d9449a838d19c7c01e1e3a62384781))
* **ci:** handle dispatched release gates ([c6d2937](https://github.com/jbcom/koota-kit/commit/c6d2937c5c12bc234e85010ad2d3d46e5475f583))
* **ci:** keep the title gate unique ([528dd9e](https://github.com/jbcom/koota-kit/commit/528dd9e4692235bb0be58782d0b87ea865b38933))
* **ci:** run pre-commit without a mutable action dependency ([e5b61b7](https://github.com/jbcom/koota-kit/commit/e5b61b7b6be206bb91a5cf6184f6a54cb861fe9b))
* correctly locate the JSON array in npm pack output, not the first '[' ([b791621](https://github.com/jbcom/koota-kit/commit/b79162102ea2ec23c8df353bbcc5337101821ee4))
* disable unattested-change review gate ([6306ca4](https://github.com/jbcom/koota-kit/commit/6306ca4660ea5f14dc3137995c67632df7ed1ecc))
* document atomic Context7 restore guidance ([97b01c6](https://github.com/jbcom/koota-kit/commit/97b01c62da8c51d5d895e48d2eba1d7e91448747))
* **ecs-koota:** align facade with current Koota ([#2](https://github.com/jbcom/koota-kit/issues/2)) ([57afef0](https://github.com/jbcom/koota-kit/commit/57afef08046ccc3bb2e46ddbbc0f5092fc2e217a))
* enable release changelog lint override ([3ba3434](https://github.com/jbcom/koota-kit/commit/3ba3434eed69ffbcd76e8f61948b747e6af162da))
* enable release changelog lint override ([1c2ed71](https://github.com/jbcom/koota-kit/commit/1c2ed71c742f86677f1fddf7d08971f9c0140f58))
* harden generated pull request automation ([9764c5f](https://github.com/jbcom/koota-kit/commit/9764c5ffc501037685e63ad7a133322c526c74d3))
* keep npm-published README links resolvable within the package file set ([c3d38ea](https://github.com/jbcom/koota-kit/commit/c3d38ea1f4af397125acea5b06b4fa9abc3b68ee))
* make release gates portable on Windows ([53f23aa](https://github.com/jbcom/koota-kit/commit/53f23aa6ad25ac0de782fc1150e895f60595cc14))
* make verify-package.mjs resilient to npm pack lifecycle-script output ([0dd677b](https://github.com/jbcom/koota-kit/commit/0dd677bf0fd87e27bd7c9173e8c800b8c54d7bf0))
* match generated changelog lint override ([fceaa2a](https://github.com/jbcom/koota-kit/commit/fceaa2a381ba837b295c5217d49c76fa4f04196e))
* match generated changelog lint override ([529971a](https://github.com/jbcom/koota-kit/commit/529971ae9780c5e64eba1bac993e4ff42c86e8e9))
* normalize cross-platform line endings ([425f956](https://github.com/jbcom/koota-kit/commit/425f9569d03674e6ef708bbd74bc5815d322dfa7))
* publish koota-kit as an unscoped package ([e26dbbc](https://github.com/jbcom/koota-kit/commit/e26dbbcc394e0da5405a2b48b8e87781206df6d0))
* publish koota-kit as an unscoped package ([1a922ce](https://github.com/jbcom/koota-kit/commit/1a922ce3190bbf99a02990492bd799da69406bc5))
* require the observed PR-title check ([7f16ffa](https://github.com/jbcom/koota-kit/commit/7f16ffa9cfead5e13578aaaf6ccd1a4b6bcadc7e))
* restrict SonarCloud pull request scans ([efd4178](https://github.com/jbcom/koota-kit/commit/efd4178cd2d2c4f7a27d6c5dc88a1f007fade550))
* skip SonarCloud scans for Dependabot ([dd1e048](https://github.com/jbcom/koota-kit/commit/dd1e048322ea601c719aec077a897fb8ceea9dea))
* trigger trusted release automation ([01acd0f](https://github.com/jbcom/koota-kit/commit/01acd0f5d2c255ee98a36b4a643a3dc1cb0805d4))
* wait for generated pull request requirements ([9719102](https://github.com/jbcom/koota-kit/commit/97191025d8fdd243b857cabf37fb8384cb776c97))
* wait for generated pull request requirements ([440a1fe](https://github.com/jbcom/koota-kit/commit/440a1fe0a7f3aa2f320ad1cc0372cbca795e679e))

## Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/) and uses
[Conventional Commits](https://www.conventionalcommits.org/) to drive releases.

## Unreleased

### Added

- Release-ready `@jbdevprimary/koota-kit` package with ESM and CommonJS entry
  points.
- Idempotent world teardown and validated, atomic snapshot restoration.
- Independent deterministic `gen` and `events` random streams.
- Compile-time and runtime guards for object-valued Koota traits.
- World-scoped event logs with consuming and observational read paths.
- Runnable examples, package-consumer checks, API/architecture documentation,
  and Node 22/24 Linux plus Node 24 Windows CI coverage.
- Repository-level LF normalization so formatter checks behave identically on
  Windows, macOS, and Linux checkouts.

### Changed

- `WorldHandle.world`, `WorldHandle.seeds`, and `WorldHandle.scratch` are
  readonly references; seed values are copied and frozen at creation.
- Invalid RNG bounds, probabilities, clock values, event-log keys, and
  persisted headers now fail with `TypeError` or `RangeError` instead of
  producing invalid state.
