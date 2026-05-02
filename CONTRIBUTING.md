# Contributing

Thanks for your interest in improving the Spice Cloud Deploy Action.

## Development workflow

1. Fork and clone the repo.
2. Install Node 20 (see `.nvmrc`) and run `npm install`.
3. Make your changes under `src/`. Run `npm run all` before opening a PR — it runs lint, typecheck, tests, and rebuilds `dist/`.
4. **Commit `dist/index.js` and `dist/index.js.map`** with the rest of your change. CI verifies the bundled output matches `src/`.
5. Update `CHANGELOG.md` under the `## [Unreleased]` section with a one-line entry per user-visible change.
6. Update `README.md` and `action.yml` whenever you change inputs/outputs.

## Test the action against a live Spice Cloud org

The `Test action` workflow (`.github/workflows/test-action.yml`) deploys against a real Spice Cloud app using the `spice-cloud` GitHub Environment. It is gated on `workflow_dispatch` so you can trigger it from a fork/branch with the appropriate secrets configured.

## Cutting a release

1. Bump the version in `package.json` and add a `## [<version>]` section to `CHANGELOG.md`.
2. Open a release PR, get it approved and merged.
3. Tag the commit on `trunk`: `git tag v1.x.y && git push origin v1.x.y`.
4. The release workflow updates the floating major-version tag (e.g. `v1`) and creates a GitHub release using the changelog notes.

Consumers should pin to a major (`@v1`) for ongoing patches or to an exact tag (`@v1.x.y`) for reproducible builds.

## Code style

Linting and formatting are handled by [Biome](https://biomejs.dev) — `npm run lint` and `npm run format` are your friends. Source files live under `src/` and tests under `__tests__/`.
