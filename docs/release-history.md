---
title: Release history
description: Release history maintained by Release Please from merged pull requests.
---

Release Please maintains the canonical
[CHANGELOG.md](https://github.com/jbcom/koota-kit/blob/main/CHANGELOG.md),
version metadata, tags, and GitHub Releases. Published releases use npm
provenance and the project supports the latest `0.x` line.

For planned changes, use a Conventional Commit type such as `fix:`, `feat:`,
`docs:`, `refactor:`, `test:`, or `chore:`. Release Please uses these commits
to select the version, while GitHub release notes list each merged pull request
once. Breaking public API changes need a `!` or `BREAKING CHANGE:` footer.

## Release publication and concurrency

The Continuous Delivery workflow (`.github/workflows/cd.yml`) triggers on completed
`CI` and `Release` workflow runs on `main`. To prevent GitHub Pages deployment events from
cancelling pending npm release publications, CD jobs use job-level concurrency isolation:

- **`deploy`**: Uses the `pages` concurrency group (`cancel-in-progress: false`) to serialize Pages deployments.
- **`publish`**: Uses an independent `npm-publish` concurrency group (`cancel-in-progress: false`, `queue: max`) to queue and retain release publication jobs across concurrent workflow triggers.
