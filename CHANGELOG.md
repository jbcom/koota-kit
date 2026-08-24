# Changelog

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
