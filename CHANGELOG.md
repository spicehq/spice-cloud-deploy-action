# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-05-03

### Breaking changes
- **`secrets` input is now a YAML/JSON map, not `KEY=VALUE` lines.** Mirrors the `tags` input shape. Update existing workflows to swap `=` for `:` between key and value:
  ```yaml
  # Before (1.0.0)
  secrets: |
    OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}
  # After (1.1.0)
  secrets: |
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  ```
  Secret-name validation is unchanged (must start with a letter or underscore, alphanumeric + underscores only). Secret values can contain any characters and are added to the runner's secret-mask list before any API call.
- **Tag values are now strictly validated against the Spice Cloud API's allowed character set** (alphanumeric plus `_@-`). Previously the action only enforced length, so values like `repo: foo/bar` would round-trip to the API and fail there with a generic `400`. Workflows that passed `/`, `:`, spaces, or other special characters in tag values must update to use only `_@-` (the action also auto-sanitizes the auto-captured `repository` tag).

### Added
- **`org` input** controlling the `app-url` output, which is now constructed as `https://spice.ai/<org>/<app-name>` (the canonical Spice Cloud portal URL). When `org` is unset, it falls back to the owner part of `GITHUB_REPOSITORY`, which matches the Spice org slug for personal orgs and orgs created from a connected GitHub organization.
- **`flight-url` input** for the regional Apache Arrow Flight gRPC endpoint. When unset, derived from the resolved app's region as `<region>-prod-aws-flight.spiceai.io:443` (mirrors the data hostname with `-data` swapped for `-flight`). A `grpc+tls://` / `grpc://` scheme prefix on the input is stripped automatically.
- **`dataset-ready-timeout-seconds` input** for a post-deploy dataset readiness check. The action polls `GET /v1/datasets?status=true` until every dataset reaches a terminal-ok state (`ready`, `disabled`, or `refreshing`) and fails immediately on `error` or on timeout-while-pending — independent of `fail-on-test-error`, which only governs runtime-probe results. Statuses like `shuttingdown` and any unrecognized values are treated as still-pending so the loop never returns a false-positive "loaded". Default `300` seconds, set `0` to skip.
- **`datasets` action output** — JSON array of `{ name, status, from?, error?, error_message? }` from the `/v1/datasets?status=true` response. Also rendered as a "Datasets" table in the GitHub job step summary.
- **Auto-captured `repository` tag** from `GITHUB_REPOSITORY` when set, sanitized to fit the API's tag-value rule (`/` → `_`). Users can override by setting `repository:` explicitly in the `tags` input.
- **Per-call response time logging.** Every Spice Cloud Management API call now logs `<METHOD> <path> → <status> <statusText> (<durationMs>ms)` so request latency is visible inline in the action logs. Network failures log `<METHOD> <path> → network error in <durationMs>ms: <message>`.

### Changed
- Bump the action runtime from Node 20 to Node 24 (`runs.using: node24`). Node 20 actions are deprecated by GitHub and will be force-defaulted to Node 24 on June 2, 2026, with Node 20 removed from the runner on September 16, 2026. Build target, CI matrix, `engines.node`, and `.nvmrc` are aligned to Node 24.

### Fixed
- `app-url` output was previously `https://<app-name>.spice.ai`, which doesn't resolve. It is now `https://spice.ai/<org>/<app-name>`.
- SQL smoke test failed with `14 UNAVAILABLE: No connection established` because the SDK initialized a gRPC client with no `flightUrl` configured for Spice Cloud. The action now derives a regional flight URL by default; the SDK uses gRPC for SQL queries with HTTP fallback as designed.
- The Spice Cloud `GET /v1/apps/{appId}/api-keys` response is `{ api_key, api_key_2 }`, but the action was reading `{ primary, secondary }` and bailing with `Cannot run runtime probes: no API key returned for app …` whenever runtime probes were enabled. Smoke tests now correctly retrieve the primary (or secondary) key.
- Step-summary "Branch" cell was empty when the management API's list-deployments response omitted the `branch` field even though the create request set it. The summary now falls back to the `branch` and `commit-sha` inputs we sent.
- Suppress the `(node:NNNN) [DEP0040] DeprecationWarning: The 'punycode' module is deprecated` runtime warning by aliasing the bare `punycode` specifier to the userland `punycode@2` package at bundle time.
- `action.yml` no longer embeds literal `${{ … }}` example tokens in `description:` blocks, which the runner was evaluating at action-load time and erroring out with `Unrecognized named-value: 'github'` / `'secrets'`.

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
