# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Auto-capture a `repository` tag from `GITHUB_REPOSITORY` when set, sanitized to fit the API's tag-value rule (`/` → `_`). Users can override by setting `repository:` explicitly in the `tags` input.

### Changed
- `parseTags` now validates tag values against the Spice Cloud API rule (alphanumeric plus `_@-`). Previously the action only enforced length, so values like `repo: foo/bar` would round-trip to the API and fail there with a generic 400.
- Bump the action runtime from Node 20 to Node 24 (`runs.using: node24`). Node 20 actions are deprecated by GitHub and will be force-defaulted to Node 24 on June 2, 2026, with Node 20 removed from the runner on September 16, 2026. The build target, CI matrix, `engines.node`, and `.nvmrc` are aligned to Node 24.

## [1.0.0] — 2026-05-02

### Added
- Initial release of the Spice Cloud Deploy Action.
- OAuth 2.0 client credentials authentication against the Spice Cloud Management API.
- Resolve apps by `app-id` or `app-name`, with optional `create-app-if-missing` flow.
- App tag merging via `tags` input — accepts a YAML block mapping (recommended) or JSON object.
- Optional Spicepod manifest push from `spicepod.yaml` before deploy.
- Bulk app secret upsert from a multi-line `secrets` input (values masked in logs).
- Deployment trigger with `branch`/`commit_sha`/`commit_message` auto-populated from the GitHub event.
- Optional polling until the deployment reaches a terminal status.
- Post-deploy smoke tests using the `@spiceai/spice` SDK (SQL via `sqlJson`, NSQL via `nsql`, ready check via `isSpiceReady`) plus raw HTTP probes for `/v1/chat/completions`, `/v1/search`, and `/v1/mcp`.
- Region-aware runtime URL derivation (`https://<region>-prod-aws-data.spiceai.io`) and `runtime-url` override.
- GitHub job step summary with deployment metadata and a per-probe pass/fail table.
- Cross-platform support (`ubuntu-latest`, `macos-latest`, `windows-latest` Node 20 action).
