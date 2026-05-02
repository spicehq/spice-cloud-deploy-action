import * as core from "@actions/core";
import type { SpiceApiClient } from "./api.js";
import { DeploymentFailedError, DeploymentTimeoutError, InputValidationError } from "./errors.js";
import type { ActionInputs } from "./inputs.js";
import { deriveRuntimeUrl, deriveRuntimeUrlFromCname } from "./inputs.js";
import { buildProbePlans } from "./probes.js";
import { RuntimeClient } from "./runtime.js";
import type { ProbeResult } from "./runtime.js";
import { parseSecrets } from "./secrets.js";
import { readSpicepod } from "./spicepod.js";
import { parseTags } from "./tags.js";
import type {
  App,
  CreateDeploymentBody,
  Deployment,
  DeploymentStatus,
  UpdateAppBody,
} from "./types.js";

export interface DeployResult {
  app: App;
  deployment: Deployment;
  probeResults: ProbeResult[];
}

const TERMINAL_STATUSES: ReadonlySet<DeploymentStatus> = new Set(["succeeded", "failed"]);

export interface DeployDeps {
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  runtimeFactory?: (apiKey: string, inputs: ActionInputs) => RuntimeClient;
}

export async function runDeploy(
  api: SpiceApiClient,
  inputs: ActionInputs,
  deps: DeployDeps = {},
): Promise<DeployResult> {
  const clock = deps.clock ?? defaultClock;
  const app = await resolveApp(api, inputs);
  core.info(`Using app "${app.name}" (id=${app.id}).`);

  await maybeUpdateAppMetadata(api, app, inputs);
  await maybePushSpicepod(api, app, inputs);
  await maybeUpsertSecrets(api, app, inputs);

  const body = buildDeploymentBody(inputs);
  core.startGroup("Trigger deployment");
  core.info(`POST /v1/apps/${app.id}/deployments`);
  core.info(`Payload: ${JSON.stringify(body)}`);
  const deployment = await api.createDeployment(app.id, body);
  core.info(`Deployment created (id=${deployment.id}, status=${deployment.status}).`);
  core.endGroup();

  let final = deployment;
  if (inputs.waitForCompletion) {
    final = await waitForDeployment(api, app.id, deployment, inputs, clock);
  }

  let probeResults: ProbeResult[] = [];
  if (final.status === "succeeded") {
    probeResults = await runSmokeTests(api, app, inputs, deps);
  }

  return { app, deployment: final, probeResults };
}

async function resolveApp(api: SpiceApiClient, inputs: ActionInputs): Promise<App> {
  if (inputs.appId) {
    const app = await api.getApp(inputs.appId);
    if (inputs.appName && app.name !== inputs.appName) {
      core.warning(
        `app-id ${inputs.appId} is named "${app.name}" but input app-name was "${inputs.appName}". Using id.`,
      );
    }
    if (inputs.region && app.region && app.region !== inputs.region) {
      core.info(
        `Existing app is in region "${app.region}" (input region "${inputs.region}" ignored).`,
      );
    }
    return app;
  }

  if (!inputs.appName) {
    throw new InputValidationError(`Either "app-id" or "app-name" must be provided.`);
  }

  const apps = await api.listApps();
  const found = apps.find((a) => a.name === inputs.appName);
  if (found) {
    if (inputs.region && found.region && found.region !== inputs.region) {
      core.info(
        `App "${found.name}" is in region "${found.region}" (input region "${inputs.region}" ignored).`,
      );
    }
    return found;
  }

  if (!inputs.createAppIfMissing) {
    throw new InputValidationError(
      `App "${inputs.appName}" not found. Set "create-app-if-missing: true" to create it, or pass an existing "app-id".`,
    );
  }

  if (!inputs.region) {
    throw new InputValidationError(
      `"region" is required when creating a new app (received empty region for "${inputs.appName}").`,
    );
  }

  const tags = parseTags(inputs.tagsRaw);
  core.info(`App "${inputs.appName}" not found; creating in region "${inputs.region}".`);
  return api.createApp({
    name: inputs.appName,
    region: inputs.region,
    visibility: inputs.visibility,
    tags,
  });
}

export function resolveRuntimeUrl(app: App, inputs: ActionInputs): string {
  if (inputs.runtimeUrl) return inputs.runtimeUrl;
  if (app.cname) return deriveRuntimeUrlFromCname(app.cname);
  if (app.region) return deriveRuntimeUrl(app.region);
  if (inputs.region) return deriveRuntimeUrl(inputs.region);
  throw new InputValidationError(
    `Cannot determine runtime URL: app has no region/cname and no "runtime-url" or "region" input was provided.`,
  );
}

async function maybeUpdateAppMetadata(
  api: SpiceApiClient,
  app: App,
  inputs: ActionInputs,
): Promise<void> {
  const tags = parseTags(inputs.tagsRaw);
  if (!tags) return;

  const merged = { ...(app.tags ?? {}), ...tags };
  const update: UpdateAppBody = { tags: merged };
  core.startGroup("Update app tags");
  core.info(`PUT /v1/apps/${app.id} tags=${JSON.stringify(merged)}`);
  await api.updateApp(app.id, update);
  app.tags = merged;
  core.endGroup();
}

async function maybePushSpicepod(
  api: SpiceApiClient,
  app: App,
  inputs: ActionInputs,
): Promise<void> {
  const file = readSpicepod(inputs.spicepodPath, inputs.workingDirectory);
  if (!file) return;

  core.startGroup("Push spicepod manifest");
  core.info(`Pushing ${file.resolvedPath} (${file.contents.length} bytes) to app ${app.id}.`);
  await api.updateApp(app.id, { spicepod: file.contents });
  core.info("Spicepod manifest updated.");
  core.endGroup();
}

async function maybeUpsertSecrets(
  api: SpiceApiClient,
  app: App,
  inputs: ActionInputs,
): Promise<void> {
  const secrets = parseSecrets(inputs.secretsRaw);
  if (secrets.length === 0) return;

  core.startGroup(`Upsert ${secrets.length} secret(s)`);
  for (const secret of secrets) {
    core.info(`POST /v1/apps/${app.id}/secrets — ${secret.name}`);
    await api.upsertSecret(app.id, secret.name, secret.value);
  }
  core.endGroup();
}

function buildDeploymentBody(inputs: ActionInputs): CreateDeploymentBody {
  const body: CreateDeploymentBody = {};
  if (inputs.imageTag) body.image_tag = inputs.imageTag;
  if (inputs.channel) body.channel = inputs.channel;
  if (inputs.replicas !== undefined) body.replicas = inputs.replicas;
  if (inputs.branch) body.branch = inputs.branch;
  if (inputs.commitSha) body.commit_sha = inputs.commitSha;
  if (inputs.commitMessage) {
    body.commit_message = inputs.commitMessage.split("\n", 1)[0]?.slice(0, 500);
  }
  if (inputs.debug) body.debug = true;
  return body;
}

async function runSmokeTests(
  api: SpiceApiClient,
  app: App,
  inputs: ActionInputs,
  deps: DeployDeps,
): Promise<ProbeResult[]> {
  const plans = buildProbePlans(inputs);
  if (plans.length === 0) return [];

  core.startGroup(`Run ${plans.length} runtime probe(s)`);
  try {
    const keys = await api.getApiKeys(app.id);
    const apiKey = keys.primary ?? keys.secondary;
    if (!apiKey) {
      const message = `Cannot run runtime probes: no API key returned for app ${app.id}.`;
      if (inputs.failOnTestError) throw new Error(message);
      core.warning(message);
      return [];
    }
    core.setSecret(apiKey);

    const runtimeUrl = resolveRuntimeUrl(app, inputs);
    core.info(`Runtime URL: ${runtimeUrl}`);

    const runtime = deps.runtimeFactory
      ? deps.runtimeFactory(apiKey, { ...inputs, runtimeUrl })
      : new RuntimeClient({
          apiKey,
          baseUrl: runtimeUrl,
          warmupSeconds: inputs.testWarmupSeconds,
          timeoutSeconds: inputs.testTimeoutSeconds,
          clock: deps.clock,
        });

    try {
      await runtime.waitForReady();
    } catch (err) {
      const message = `Runtime warmup failed: ${(err as Error).message}`;
      if (inputs.failOnTestError) throw new Error(message);
      core.warning(message);
      return [];
    }

    const results: ProbeResult[] = [];
    for (const plan of plans) {
      core.info(`→ ${plan.description}`);
      const result = await plan.run(runtime);
      results.push(result);
      if (result.ok) {
        core.info(
          `✓ ${plan.name} (${result.durationMs}ms)${result.detail ? ` — ${result.detail}` : ""}`,
        );
      } else {
        const line = `✗ ${plan.name} (${result.durationMs}ms) — ${result.error}`;
        if (inputs.failOnTestError) core.error(line);
        else core.warning(line);
      }
    }
    return results;
  } finally {
    core.endGroup();
  }
}

async function waitForDeployment(
  api: SpiceApiClient,
  appId: number,
  initial: Deployment,
  inputs: ActionInputs,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
): Promise<Deployment> {
  if (TERMINAL_STATUSES.has(initial.status)) {
    if (initial.status === "failed") {
      throw new DeploymentFailedError(initial.id, initial.error ?? undefined);
    }
    return initial;
  }

  const deadline = clock.now() + inputs.timeoutSeconds * 1000;
  const intervalMs = inputs.pollIntervalSeconds * 1000;
  let last: Deployment = initial;

  core.startGroup(`Wait for deployment ${initial.id}`);
  try {
    while (clock.now() < deadline) {
      await clock.sleep(intervalMs);
      const list = await api.listDeployments(appId, { limit: 20 });
      const match = list.find((d) => String(d.id) === String(initial.id));
      if (match) {
        if (match.status !== last.status) {
          core.info(`status: ${last.status} → ${match.status}`);
        }
        last = match;
        if (TERMINAL_STATUSES.has(match.status)) {
          if (match.status === "failed") {
            throw new DeploymentFailedError(match.id, match.error ?? undefined);
          }
          return match;
        }
      } else {
        core.debug(`Deployment ${initial.id} not yet visible in list; will retry.`);
      }
    }
    throw new DeploymentTimeoutError(initial.id, last.status, inputs.timeoutSeconds);
  } finally {
    core.endGroup();
  }
}

const defaultClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
