import * as core from "@actions/core";
import { SpiceApiClient } from "./api.js";
import { OAuthClient } from "./auth.js";
import { runDeploy } from "./deploy.js";
import {
  DeploymentFailedError,
  DeploymentTimeoutError,
  InputValidationError,
  OAuthError,
  SpiceApiError,
} from "./errors.js";
import { type ActionInputs, readInputs } from "./inputs.js";
import type { DatasetState, ProbeResult } from "./runtime.js";

async function run(): Promise<void> {
  let inputs: ActionInputs;
  try {
    inputs = readInputs();
  } catch (err) {
    if (err instanceof InputValidationError) {
      core.setFailed(err.message);
      return;
    }
    throw err;
  }

  core.setSecret(inputs.clientSecret);

  const oauth = new OAuthClient({
    tokenUrl: inputs.oauthTokenUrl,
    clientId: inputs.clientId,
    clientSecret: inputs.clientSecret,
    scope: inputs.scope,
  });
  const api = new SpiceApiClient({ baseUrl: inputs.apiUrl, oauth });

  try {
    const { app, deployment, probeResults, datasets } = await runDeploy(api, inputs);

    const appUrl = `https://${app.name}.spice.ai`;
    core.setOutput("app-id", String(app.id));
    core.setOutput("app-name", app.name);
    core.setOutput("app-url", appUrl);
    core.setOutput("deployment-id", String(deployment.id));
    core.setOutput("deployment-status", deployment.status);
    core.setOutput("deployment-created-at", deployment.created_at ?? "");
    core.setOutput("test-results", JSON.stringify(probeResults));
    core.setOutput("datasets", JSON.stringify(datasets));

    await writeSummary({ app, deployment, appUrl, probeResults, datasets });

    core.info(`Deployment ${deployment.id} status: ${deployment.status}`);
    core.info(`App URL: ${appUrl}`);

    const failedProbe = probeResults.find((r) => !r.ok);
    if (failedProbe && inputs.failOnTestError) {
      core.setFailed(
        `${probeResults.filter((r) => !r.ok).length} runtime probe(s) failed (first: ${failedProbe.name} — ${failedProbe.error}).`,
      );
    }
  } catch (err) {
    handleError(err);
  }
}

function handleError(err: unknown): void {
  if (err instanceof InputValidationError) {
    core.setFailed(err.message);
    return;
  }
  if (err instanceof OAuthError) {
    core.setFailed(`Authentication failed (${err.status}): ${err.message}`);
    return;
  }
  if (err instanceof SpiceApiError) {
    core.setFailed(err.message);
    return;
  }
  if (err instanceof DeploymentFailedError) {
    core.setFailed(err.message);
    return;
  }
  if (err instanceof DeploymentTimeoutError) {
    core.setFailed(err.message);
    return;
  }
  if (err instanceof Error) {
    core.setFailed(err.message);
    return;
  }
  core.setFailed(`Unexpected error: ${String(err)}`);
}

async function writeSummary(args: {
  app: { id: number; name: string };
  deployment: { id: number | string; status: string; commit_sha?: string; branch?: string };
  appUrl: string;
  probeResults: ProbeResult[];
  datasets: DatasetState[];
}): Promise<void> {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { app, deployment, appUrl, probeResults, datasets } = args;
  const statusBadge =
    deployment.status === "succeeded"
      ? "**succeeded**"
      : deployment.status === "failed"
        ? "**failed**"
        : `_${deployment.status}_`;

  const summary = core.summary.addHeading("Spice Cloud Deploy", 2).addTable([
    [
      { data: "Field", header: true },
      { data: "Value", header: true },
    ],
    ["App", `${app.name} (id ${app.id})`],
    ["URL", `<a href="${appUrl}">${appUrl}</a>`],
    ["Deployment", String(deployment.id)],
    ["Status", statusBadge],
    ["Branch", deployment.branch ?? ""],
    ["Commit", deployment.commit_sha ?? ""],
  ]);

  if (datasets.length > 0) {
    summary.addHeading("Datasets", 3).addTable([
      [
        { data: "Name", header: true },
        { data: "Status", header: true },
        { data: "Source", header: true },
        { data: "Error", header: true },
      ],
      ...datasets.map((d) => [
        d.name,
        d.status,
        d.from ?? "",
        d.error_message ?? d.error?.code ?? "",
      ]),
    ]);
  }

  if (probeResults.length > 0) {
    summary.addHeading("Runtime probes", 3).addTable([
      [
        { data: "Probe", header: true },
        { data: "Result", header: true },
        { data: "Duration", header: true },
        { data: "Detail", header: true },
      ],
      ...probeResults.map((r) => [
        r.name,
        r.ok ? "pass" : "fail",
        `${r.durationMs}ms`,
        r.ok ? (r.detail ?? "") : (r.error ?? ""),
      ]),
    ]);
  }

  await summary.write();
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
