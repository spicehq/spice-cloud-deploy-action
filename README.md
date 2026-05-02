<div align="center">

# Spice Cloud Deploy Action

[![CI](https://github.com/spicehq/spice-cloud-deploy-action/actions/workflows/ci.yml/badge.svg)](https://github.com/spicehq/spice-cloud-deploy-action/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/spicehq/spice-cloud-deploy-action?logo=github&color=1F8AC0)](https://github.com/spicehq/spice-cloud-deploy-action/releases)
[![Marketplace](https://img.shields.io/badge/marketplace-spice--cloud--deploy-1F8AC0?logo=githubactions&logoColor=white)](https://github.com/marketplace/actions/spice-cloud-deploy)
[![License](https://img.shields.io/badge/license-Apache%202.0-1F8AC0)](LICENSE)

Deploy a [Spice.ai Cloud](https://spice.ai) app from any GitHub workflow using OAuth client credentials, then optionally smoke-test the deployed runtime with SQL, NSQL, search, chat, and MCP probes.

</div>

---

## Highlights

- **OAuth client credentials** — no long-lived personal tokens. Generate an OAuth client in the Spice Cloud Portal and store the secret in your repo's secrets.
- **One step, full lifecycle** — resolve or create the app, push your `spicepod.yaml`, upsert app secrets, trigger the deployment, and (optionally) wait for it to finish.
- **Post-deploy smoke tests** — verify the freshly-deployed runtime answers SQL, NSQL, search, chat-completion, and MCP requests before declaring the workflow green. SQL/NSQL/health probes use the official [`@spiceai/spice` SDK](https://www.npmjs.com/package/@spiceai/spice).
- **Tags, region, replicas, channel** — all the dials you'd expect, plus deployment metadata (`branch`, `commit_sha`, `commit_message`) auto-populated from the GitHub event.
- **Cross-platform** — Node 24 JavaScript action; runs on `ubuntu-latest`, `macos-latest`, and `windows-latest` runners.

## Quickstart

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: spicehq/spice-cloud-deploy-action@v1
        with:
          client-id:     ${{ secrets.SPICE_CLIENT_ID }}
          client-secret: ${{ secrets.SPICE_CLIENT_SECRET }}
          app-name:      my-app
          spicepod:      spicepod.yaml
          test-sql:      SELECT 1
```

The action returns once the deployment is `succeeded` (or fails the job if it's `failed` / `timed-out`).

## Setting up an OAuth client

1. Sign in to the [Spice.ai Portal](https://spice.ai).
2. Open **Profile → OAuth Clients** and click **Create**.
3. **Grant the scopes you need** (see the table below). The action will fail with `403 Forbidden` if a required scope is missing.
4. Copy the **client ID** and **client secret** — the secret is shown only once.
5. In your GitHub repo (or org), add two secrets: `SPICE_CLIENT_ID` and `SPICE_CLIENT_SECRET`.

The action exchanges the client credentials at `https://spice.ai/api/oauth/token` for a short-lived bearer token (cached for the run).

### Scope cheat sheet

Grant exactly the scopes for the features you use. The "All-in" row at the bottom is what you'd typically pick for a CI client that does everything this action supports.

| Use this action to… | Required scopes |
| --- | --- |
| Resolve an existing app and trigger a deployment             | `apps:read`, `deployments:read`, `deployments:write` |
| Create the app on first run (`create-app-if-missing: true`)  | + `apps:write` |
| Push a `spicepod.yaml` manifest to the app before deploying  | + `apps:write` |
| Set or merge app `tags`                                      | + `apps:write` |
| Upsert app `secrets` before deploying                        | + `secrets:write` |
| Run runtime smoke tests (`test-sql`, `test-nsql`, etc.)      | _no extra scope_ — uses `apps:read`, already required |
| **All-in (recommended for a single CI client)**              | **`apps:read` `apps:write` `deployments:read` `deployments:write` `secrets:write`** |

> Avoid the `*` wildcard scope in production — it grants `apps:delete`, `secrets:read` (decrypted via the portal), and `members:*`, which this action never needs.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `client-id`             | yes | — | OAuth client ID. |
| `client-secret`         | yes | — | OAuth client secret. Mark as a repo/env secret. |
| `app-id`                | conditional | — | Numeric app ID. Either this or `app-name` is required. |
| `app-name`              | conditional | — | App name. Required when `create-app-if-missing` is true. |
| `create-app-if-missing` | no | `false` | Create the app if it doesn't exist (requires `app-name` and `region`). |
| `region`                | conditional | — | Spice Cloud region (e.g. `us-east-1`, `us-west-2`). Required for new apps. |
| `visibility`            | no | `private` | `public` or `private` — only used on app creation. |
| `tags`                  | no | — | YAML or JSON map of tag key/value pairs. Merged into existing app tags. Tag values may contain only alphanumerics and `_@-`. The action auto-adds a `repository` tag from `GITHUB_REPOSITORY` (sanitizing `/` → `_`) unless you override it. |
| `spicepod`              | no | `spicepod.yaml` | Path to the Spicepod manifest. Pushed to the app before deploy when present. |
| `working-directory`     | no | `.` | Working directory used to resolve relative paths. |
| `image-tag`             | no | — | Override the runtime image tag (e.g. `1.5.0-models`). |
| `channel`               | no | — | `stable`, `preview`, `nightly`, or `internal`. |
| `replicas`              | no | — | Replica count for this deployment (1-10). |
| `branch`                | no | `${{ github.ref_name }}` | Git branch attributed to the deployment. |
| `commit-sha`            | no | `${{ github.sha }}` | Commit SHA attributed to the deployment. |
| `commit-message`        | no | head-commit message | Commit message attributed to the deployment. |
| `debug`                 | no | `false` | Enable runtime debug mode for this deployment. |
| `secrets`               | no | — | Multi-line `KEY=VALUE` app secrets to upsert before deploy. Values are masked. |
| `wait-for-completion`   | no | `true` | Poll the deployment until it finishes. |
| `timeout-seconds`       | no | `600` | Max wait when `wait-for-completion` is true. |
| `poll-interval-seconds` | no | `10` | Seconds between status polls. |
| `test-sql`              | no | — | SQL query smoke test (uses `@spiceai/spice` SDK). |
| `test-nsql`             | no | — | Natural-language → SQL smoke test. |
| `test-chat`             | no | — | Plain prompt or JSON body for `/v1/chat/completions`. |
| `test-chat-model`       | no | — | Model used for `test-chat` and `test-nsql`. |
| `test-search`           | no | — | JSON body for `/v1/search`. |
| `test-mcp-tool`         | no | — | MCP tool name to invoke against `/v1/mcp`. |
| `test-mcp-arguments`    | no | `{}` | JSON-encoded arguments for the MCP tool call. |
| `test-warmup-seconds`   | no | `60` | Max wait for `isSpiceReady()` before running probes. |
| `test-timeout-seconds`  | no | `30` | Per-probe HTTP timeout. |
| `runtime-url`           | no | derived | Override probe base URL. By default derived from the app's region as `https://<region>-prod-aws-data.spiceai.io`. |
| `fail-on-test-error`    | no | `true` | Fail the job when any probe fails. |
| `api-url`               | no | `https://api.spice.ai` | Management API base URL. |
| `oauth-token-url`       | no | `https://spice.ai/api/oauth/token` | OAuth token endpoint. |
| `scope`                 | no | — | Optional space-separated OAuth scopes to request. |

## Outputs

| Output | Description |
| --- | --- |
| `app-id` | Resolved numeric app ID. |
| `app-name` | Resolved app name. |
| `app-url` | `https://<app-name>.spice.ai`. |
| `deployment-id` | Created deployment ID. |
| `deployment-status` | Final status (`queued`, `in_progress`, `succeeded`, `failed`). |
| `deployment-created-at` | ISO 8601 timestamp the deployment was created. |
| `test-results` | JSON array of `{ name, ok, durationMs, detail?, error? }`. |

## Examples

### Bootstrap an app on first run

```yaml
- uses: spicehq/spice-cloud-deploy-action@v1
  with:
    client-id:             ${{ secrets.SPICE_CLIENT_ID }}
    client-secret:         ${{ secrets.SPICE_CLIENT_SECRET }}
    app-name:              analytics
    region:                us-east-1
    create-app-if-missing: true
    visibility:            private
    tags: |
      environment: production
      team: data-platform
      commit: ${{ github.sha }}
```

> `tags` accepts either a YAML block mapping (shown above) or a JSON object string (e.g. `tags: '{"environment":"production","team":"data-platform"}'`). Tags are merged into the app's existing tags on every run.
>
> **Tag value rule:** the Spice Cloud API allows only alphanumerics and `_@-`. The action validates this locally so you fail fast with a clear error instead of a `400 Bad Request` on the server.
>
> **Auto-captured tags:** when `GITHUB_REPOSITORY` is set (always true on GitHub-hosted runners), the action adds a `repository` tag derived from that env var, with `/` rewritten to `_` so the value passes API validation. Setting `repository:` explicitly in your `tags` overrides the auto-captured value.

### Upsert app secrets and run a SQL smoke test

```yaml
- uses: spicehq/spice-cloud-deploy-action@v1
  with:
    client-id:     ${{ secrets.SPICE_CLIENT_ID }}
    client-secret: ${{ secrets.SPICE_CLIENT_SECRET }}
    app-name:      analytics
    secrets: |
      OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}
      PG_PASSWORD=${{ secrets.PG_PASSWORD }}
    test-sql: SELECT count(*) FROM taxi_trips
```

### Verify chat, search, and MCP after a successful deploy

```yaml
- uses: spicehq/spice-cloud-deploy-action@v1
  with:
    client-id:     ${{ secrets.SPICE_CLIENT_ID }}
    client-secret: ${{ secrets.SPICE_CLIENT_SECRET }}
    app-name:      analytics
    test-chat:     "Summarize today's top 3 trips"
    test-chat-model: gpt-4o-mini
    test-search: |
      {"datasets":["docs"],"text":"refund policy","limit":3}
    test-mcp-tool: list_resources
    test-mcp-arguments: '{"limit":5}'
```

### Preview deploy on every PR, production deploy on main

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: spicehq/spice-cloud-deploy-action@v1
        with:
          client-id:     ${{ secrets.SPICE_CLIENT_ID }}
          client-secret: ${{ secrets.SPICE_CLIENT_SECRET }}
          app-name: ${{ github.event_name == 'pull_request' && format('analytics-pr-{0}', github.event.number) || 'analytics' }}
          region: us-east-1
          create-app-if-missing: true
          channel: ${{ github.event_name == 'pull_request' && 'preview' || 'stable' }}
```

### Use the deployment outputs in subsequent steps

```yaml
- id: deploy
  uses: spicehq/spice-cloud-deploy-action@v1
  with:
    client-id:     ${{ secrets.SPICE_CLIENT_ID }}
    client-secret: ${{ secrets.SPICE_CLIENT_SECRET }}
    app-name:      analytics

- name: Comment on the PR
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const url = '${{ steps.deploy.outputs.app-url }}';
      const status = '${{ steps.deploy.outputs.deployment-status }}';
      github.rest.issues.createComment({
        ...context.repo,
        issue_number: context.issue.number,
        body: `Spice Cloud: **${status}** → ${url}`
      });
```

## How it works

1. **Authenticate.** The action POSTs `client_id`/`client_secret` to `https://spice.ai/api/oauth/token` with `grant_type=client_credentials` and caches the bearer token for the run.
2. **Resolve or create the app.** If `app-id` is given, it's fetched directly. Otherwise the action looks up `app-name` via `GET /v1/apps`. With `create-app-if-missing: true`, a missing app is created in the requested `region`.
3. **Sync metadata.** Tags from the `tags` input are merged into the app's existing tags via `PUT /v1/apps/{id}`.
4. **Push the Spicepod.** When `spicepod.yaml` exists at `working-directory`, its contents are pushed to the app via `PUT /v1/apps/{id}` (`spicepod` field).
5. **Upsert secrets.** Each `KEY=VALUE` line in `secrets` is sent to `POST /v1/apps/{id}/secrets` (upsert).
6. **Trigger the deployment.** `POST /v1/apps/{id}/deployments` with `branch`, `commit_sha`, `commit_message`, plus any `image-tag`/`channel`/`replicas` overrides.
7. **Poll until terminal.** `GET /v1/apps/{id}/deployments` is polled every `poll-interval-seconds` up to `timeout-seconds`.
8. **Smoke-test.** When the deployment succeeds, the action fetches the app's primary API key, instantiates a [`SpiceClient`](https://www.npmjs.com/package/@spiceai/spice) against the regional runtime URL (`https://<region>-prod-aws-data.spiceai.io`), waits for `isSpiceReady()`, and runs each configured probe.

The Action job step summary records the deployment metadata and a per-probe pass/fail table.

> Wondering which scopes to grant the OAuth client? See the [Scope cheat sheet](#scope-cheat-sheet) above.

## Compatibility

- Runs on `ubuntu-latest`, `macos-latest`, and `windows-latest` (Node 24 JavaScript action).
- Bundles the `@spiceai/spice` SDK in HTTP mode — no Apache Arrow Flight gRPC dependencies are required at runtime.
- Compatible with self-hosted runners that allow outbound HTTPS to `spice.ai`, `api.spice.ai`, and the regional `*-prod-aws-data.spiceai.io` host.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Authentication failed (401)` | Bad client ID/secret or revoked client | Re-create the OAuth client in the Spice Portal and update the repo secrets. |
| `Authentication failed (403)` | Token lacks required scopes | Re-issue the OAuth client with the scopes listed above. |
| `App "X" not found` | App doesn't exist in the org | Set `create-app-if-missing: true` (and provide `region`), or pass an `app-id`. |
| `409 Conflict` on deployment | Another deployment is in progress | Wait for it to finish, or use the workflow `concurrency` key to serialize deploys. |
| `Cannot determine runtime URL` | Existing app has no region/cname and no `runtime-url` was given | Pass `region` or `runtime-url` explicitly. |
| `Runtime not ready within Ns` | Deployment finished but the runtime hasn't come up | Increase `test-warmup-seconds`, or split deploy + tests into two steps. |

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build       # produces dist/index.js
```

The `dist/` folder is committed — GitHub Actions runs the bundled JavaScript directly and does not install dependencies on the runner.

## Releasing

1. Land changes on `trunk`. CI must be green and `dist/` must be up to date.
2. Tag a SemVer release: `git tag v1.2.3 && git push origin v1.2.3`.
3. The release workflow updates the floating `v1` tag and publishes a GitHub release.

Consumers should pin to a major (`@v1`) for ongoing patches or to an exact tag (`@v1.2.3`) for reproducible builds.

## License

Apache 2.0 — see [LICENSE](LICENSE).
