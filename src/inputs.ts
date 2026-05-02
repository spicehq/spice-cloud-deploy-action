import { existsSync, readFileSync } from "node:fs";
import * as core from "@actions/core";
import { InputValidationError } from "./errors.js";

export interface ActionInputs {
  clientId: string;
  clientSecret: string;
  appId?: number;
  appName?: string;
  createAppIfMissing: boolean;
  region?: string;
  visibility: "public" | "private";
  tagsRaw?: string;
  spicepodPath: string;
  workingDirectory: string;
  imageTag?: string;
  channel?: string;
  replicas?: number;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  debug: boolean;
  secretsRaw?: string;
  waitForCompletion: boolean;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
  apiUrl: string;
  oauthTokenUrl: string;
  scope?: string;
  testSql?: string;
  testSearch?: string;
  testChat?: string;
  testChatModel?: string;
  testNsql?: string;
  testMcpTool?: string;
  testMcpArguments?: string;
  testWarmupSeconds: number;
  testTimeoutSeconds: number;
  runtimeUrl?: string;
  failOnTestError: boolean;
}

const REGION_PATTERN = /^[a-z]{2,3}-[a-z]+-\d+$/;

export function deriveRuntimeUrl(region: string): string {
  return `https://${region}-prod-aws-data.spiceai.io`;
}

export function deriveRuntimeUrlFromCname(cname: string): string {
  return `https://${cname}.spiceai.io`;
}

function getOptional(name: string): string | undefined {
  const value = core.getInput(name);
  return value === "" ? undefined : value;
}

function getBool(name: string, defaultValue: boolean): boolean {
  const raw = core.getInput(name);
  if (raw === "") return defaultValue;
  return core.getBooleanInput(name);
}

function getInt(name: string, opts?: { min?: number; max?: number }): number | undefined {
  const raw = core.getInput(name);
  if (raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new InputValidationError(`Input "${name}" must be an integer (got "${raw}").`);
  }
  if (opts?.min !== undefined && n < opts.min) {
    throw new InputValidationError(`Input "${name}" must be >= ${opts.min} (got ${n}).`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new InputValidationError(`Input "${name}" must be <= ${opts.max} (got ${n}).`);
  }
  return n;
}

function getRequiredInt(name: string, fallback: number, opts?: { min?: number }): number {
  const value = getInt(name, opts);
  return value ?? fallback;
}

function defaultBranch(): string | undefined {
  const refName = process.env.GITHUB_REF_NAME;
  if (refName) return refName;
  const ref = process.env.GITHUB_REF;
  if (ref?.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref?.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  return undefined;
}

function defaultCommitMessage(): string | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return undefined;
  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf8")) as {
      head_commit?: { message?: string };
    };
    return payload.head_commit?.message;
  } catch {
    return undefined;
  }
}

function parseVisibility(raw: string): "public" | "private" {
  if (raw === "public" || raw === "private") return raw;
  throw new InputValidationError(
    `Input "visibility" must be "public" or "private" (got "${raw}").`,
  );
}

function parseChannel(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const allowed = ["stable", "preview", "nightly", "internal"];
  if (!allowed.includes(raw)) {
    throw new InputValidationError(
      `Input "channel" must be one of ${allowed.join(", ")} (got "${raw}").`,
    );
  }
  return raw;
}

function parseAppId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InputValidationError(`Input "app-id" must be a positive integer (got "${raw}").`);
  }
  return n;
}

function parseUrl(name: string, raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new Error("must be http(s)");
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    throw new InputValidationError(`Input "${name}" must be a valid URL (got "${raw}").`);
  }
}

export function readInputs(): ActionInputs {
  const clientId = core.getInput("client-id", { required: true });
  const clientSecret = core.getInput("client-secret", { required: true });

  const appId = parseAppId(getOptional("app-id"));
  const appName = getOptional("app-name");
  const createAppIfMissing = getBool("create-app-if-missing", false);

  if (!appId && !appName) {
    throw new InputValidationError(`Either "app-id" or "app-name" must be provided.`);
  }
  if (createAppIfMissing && !appName) {
    throw new InputValidationError(`"create-app-if-missing" requires "app-name".`);
  }

  const visibility = parseVisibility(core.getInput("visibility") || "private");
  const channel = parseChannel(getOptional("channel"));
  const replicas = getInt("replicas", { min: 1, max: 10 });

  const region = getOptional("region");
  if (region && !REGION_PATTERN.test(region)) {
    throw new InputValidationError(
      `Input "region" must look like "us-east-1" or "us-west-2" (got "${region}").`,
    );
  }
  if (createAppIfMissing && !region) {
    throw new InputValidationError(`"create-app-if-missing" requires "region".`);
  }

  const apiUrl = parseUrl("api-url", core.getInput("api-url") || "https://api.spice.ai");
  const oauthTokenUrl = parseUrl(
    "oauth-token-url",
    core.getInput("oauth-token-url") || "https://spice.ai/api/oauth/token",
  );
  const runtimeUrlRaw = getOptional("runtime-url");
  const runtimeUrl = runtimeUrlRaw ? parseUrl("runtime-url", runtimeUrlRaw) : undefined;

  return {
    clientId,
    clientSecret,
    appId,
    appName,
    createAppIfMissing,
    region,
    visibility,
    tagsRaw: getOptional("tags"),
    spicepodPath: core.getInput("spicepod") || "spicepod.yaml",
    workingDirectory: core.getInput("working-directory") || ".",
    imageTag: getOptional("image-tag"),
    channel,
    replicas,
    branch: getOptional("branch") ?? defaultBranch(),
    commitSha: getOptional("commit-sha") ?? process.env.GITHUB_SHA,
    commitMessage: getOptional("commit-message") ?? defaultCommitMessage(),
    debug: getBool("debug", false),
    secretsRaw: getOptional("secrets"),
    waitForCompletion: getBool("wait-for-completion", true),
    timeoutSeconds: getRequiredInt("timeout-seconds", 600, { min: 1 }),
    pollIntervalSeconds: getRequiredInt("poll-interval-seconds", 10, { min: 1 }),
    apiUrl,
    oauthTokenUrl,
    scope: getOptional("scope"),
    testSql: getOptional("test-sql"),
    testSearch: getOptional("test-search"),
    testChat: getOptional("test-chat"),
    testChatModel: getOptional("test-chat-model"),
    testNsql: getOptional("test-nsql"),
    testMcpTool: getOptional("test-mcp-tool"),
    testMcpArguments: getOptional("test-mcp-arguments"),
    testWarmupSeconds: getRequiredInt("test-warmup-seconds", 60, { min: 0 }),
    testTimeoutSeconds: getRequiredInt("test-timeout-seconds", 30, { min: 1 }),
    runtimeUrl,
    failOnTestError: getBool("fail-on-test-error", true),
  };
}
