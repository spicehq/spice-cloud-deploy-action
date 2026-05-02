# Security

## Reporting a vulnerability

Please **do not** file a public issue for security reports. Instead, email **security@spice.ai** with:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- Any suggested mitigations.

We aim to acknowledge reports within two business days and to provide a remediation plan within ten business days.

## Handling secrets in this action

- `client-secret` and any values supplied via the `secrets` input are added to the runner's secret-mask list (`::add-mask::`) before any external request is made. They will not appear in action logs.
- The OAuth access token returned by `https://spice.ai/api/oauth/token` is masked at the moment it is received and never written to outputs or the step summary.
- The app's runtime API key (fetched after a successful deploy when smoke tests are enabled) is masked the moment it is read; it is **not** written to action outputs.
- The action communicates only with the URLs configured by `oauth-token-url`, `api-url`, and the derived/overridden `runtime-url`. All requests are HTTPS by default.

## Supported versions

We support the latest minor of the most recent major (`v1.x`). Older majors receive critical security fixes only when the upstream Spice Cloud API constraints allow.
