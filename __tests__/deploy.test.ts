import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  debug: vi.fn(),
  endGroup: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  setSecret: vi.fn(),
  startGroup: vi.fn(),
  warning: vi.fn(),
}));

const ORIGINAL_GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
beforeEach(() => {
  delete process.env.GITHUB_REPOSITORY;
});
afterEach(() => {
  if (ORIGINAL_GITHUB_REPOSITORY === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = ORIGINAL_GITHUB_REPOSITORY;
});

import type { SpiceApiClient } from "../src/api.js";
import { resolveFlightUrl, resolveRuntimeUrl, runDeploy } from "../src/deploy.js";
import {
  DeploymentFailedError,
  DeploymentTimeoutError,
  InputValidationError,
} from "../src/errors.js";
import type { ActionInputs } from "../src/inputs.js";
import type { ProbeResult, RuntimeClient } from "../src/runtime.js";
import type { App, Deployment } from "../src/types.js";

function fakeApi(overrides: Partial<Record<keyof SpiceApiClient, unknown>>): SpiceApiClient {
  return overrides as unknown as SpiceApiClient;
}

const baseInputs: ActionInputs = {
  clientId: "id",
  clientSecret: "secret",
  appName: "demo",
  createAppIfMissing: false,
  region: "us-west-2",
  visibility: "private",
  spicepodPath: "/does/not/exist.yaml",
  workingDirectory: "/tmp",
  debug: false,
  waitForCompletion: false,
  timeoutSeconds: 60,
  pollIntervalSeconds: 1,
  apiUrl: "https://api.spice.ai",
  oauthTokenUrl: "https://spice.ai/api/oauth/token",
  testWarmupSeconds: 0,
  testTimeoutSeconds: 30,
  datasetReadyTimeoutSeconds: 0,
  failOnTestError: true,
};

const sampleApp: App = {
  id: 42,
  name: "demo",
  region: "us-west-2",
  cname: "us-west-2-prod-aws-data",
};

const queuedDeployment: Deployment = { id: 7, status: "queued" };
const succeededDeployment: Deployment = { id: 7, status: "succeeded" };
const failedDeployment: Deployment = { id: 7, status: "failed", error: "boom" };

describe("runDeploy", () => {
  it("looks up app by name and triggers a deployment", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ listApps, createDeployment });

    const result = await runDeploy(api, {
      ...baseInputs,
      branch: "main",
      commitSha: "abc123",
      commitMessage: "first deploy\n\ndetails ignored",
    });

    expect(result.app).toEqual(sampleApp);
    expect(result.deployment).toEqual(queuedDeployment);
    expect(createDeployment).toHaveBeenCalledWith(42, {
      branch: "main",
      commit_sha: "abc123",
      commit_message: "first deploy",
    });
  });

  it("throws when app not found and creation is disabled", async () => {
    const listApps = vi.fn().mockResolvedValue([]);
    const api = fakeApi({ listApps });

    await expect(runDeploy(api, baseInputs)).rejects.toBeInstanceOf(InputValidationError);
  });

  it("creates the app when create-app-if-missing is true", async () => {
    const listApps = vi.fn().mockResolvedValue([]);
    const createApp = vi.fn().mockResolvedValue({ id: 99, name: "demo" });
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ listApps, createApp, createDeployment });

    await runDeploy(api, { ...baseInputs, createAppIfMissing: true });

    expect(createApp).toHaveBeenCalledWith({
      name: "demo",
      region: "us-west-2",
      visibility: "private",
    });
    expect(createDeployment).toHaveBeenCalledWith(99, {});
  });

  it("uses app-id when provided", async () => {
    const getApp = vi.fn().mockResolvedValue(sampleApp);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ getApp, createDeployment });

    await runDeploy(api, { ...baseInputs, appId: 42, appName: undefined });
    expect(getApp).toHaveBeenCalledWith(42);
  });

  it("uploads secrets before deploying", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const upsertSecret = vi.fn().mockResolvedValue(undefined);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ listApps, upsertSecret, createDeployment });

    await runDeploy(api, {
      ...baseInputs,
      secretsRaw: "OPENAI=sk-1\nPG_PASS=hunter2",
    });

    expect(upsertSecret).toHaveBeenNthCalledWith(1, 42, "OPENAI", "sk-1");
    expect(upsertSecret).toHaveBeenNthCalledWith(2, 42, "PG_PASS", "hunter2");
  });

  it("polls until success when wait-for-completion is true", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const listDeployments = vi
      .fn()
      .mockResolvedValueOnce([{ id: 7, status: "in_progress" }])
      .mockResolvedValue([succeededDeployment]);
    const api = fakeApi({ listApps, createDeployment, listDeployments });

    let nowMs = 1_000_000;
    const clock = {
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    };

    const result = await runDeploy(api, { ...baseInputs, waitForCompletion: true }, clock);
    expect(result.deployment.status).toBe("succeeded");
    expect(listDeployments).toHaveBeenCalledTimes(2);
  });

  it("throws DeploymentFailedError when polling sees a failed deployment", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const listDeployments = vi.fn().mockResolvedValue([failedDeployment]);
    const api = fakeApi({ listApps, createDeployment, listDeployments });

    let nowMs = 0;
    const clock = {
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    };

    await expect(
      runDeploy(api, { ...baseInputs, waitForCompletion: true }, clock),
    ).rejects.toBeInstanceOf(DeploymentFailedError);
  });

  it("throws DeploymentTimeoutError when polling exceeds the budget", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const listDeployments = vi.fn().mockResolvedValue([{ id: 7, status: "in_progress" }]);
    const api = fakeApi({ listApps, createDeployment, listDeployments });

    let nowMs = 0;
    const clock = {
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    };

    await expect(
      runDeploy(
        api,
        { ...baseInputs, waitForCompletion: true, timeoutSeconds: 5, pollIntervalSeconds: 2 },
        { clock },
      ),
    ).rejects.toBeInstanceOf(DeploymentTimeoutError);
  });

  it("merges new tags into existing app tags", async () => {
    const listApps = vi.fn().mockResolvedValue([{ ...sampleApp, tags: { existing: "1" } }]);
    const updateApp = vi
      .fn()
      .mockResolvedValue({ ...sampleApp, tags: { existing: "1", environment: "prod" } });
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ listApps, updateApp, createDeployment });

    await runDeploy(api, { ...baseInputs, tagsRaw: "environment: prod" });

    expect(updateApp).toHaveBeenCalledWith(42, { tags: { existing: "1", environment: "prod" } });
  });

  it("auto-captures `repository` from GITHUB_REPOSITORY when no user tag overrides it", async () => {
    process.env.GITHUB_REPOSITORY = "lukekim/home";
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const updateApp = vi.fn().mockResolvedValue(sampleApp);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ listApps, updateApp, createDeployment });

    await runDeploy(api, { ...baseInputs, tagsRaw: "environment: prod" });

    expect(updateApp).toHaveBeenCalledWith(42, {
      tags: { repository: "lukekim_home", environment: "prod" },
    });
  });

  it("user-supplied `repository` tag wins over the auto-captured default", async () => {
    process.env.GITHUB_REPOSITORY = "lukekim/home";
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const updateApp = vi.fn().mockResolvedValue(sampleApp);
    const createDeployment = vi.fn().mockResolvedValue(queuedDeployment);
    const api = fakeApi({ listApps, updateApp, createDeployment });

    await runDeploy(api, { ...baseInputs, tagsRaw: "repository: explicit-name" });

    expect(updateApp).toHaveBeenCalledWith(42, { tags: { repository: "explicit-name" } });
  });

  it("runs probes and fails when one fails (fail-on-test-error=true)", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(succeededDeployment);
    const getApiKeys = vi.fn().mockResolvedValue({ api_key: "rk_test", api_key_2: null });
    const api = fakeApi({ listApps, createDeployment, getApiKeys });

    const probeSql = vi.fn().mockResolvedValue<ProbeResult>({
      name: "sql",
      ok: false,
      durationMs: 12,
      error: "boom",
    });
    const fakeRuntime = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
      probeSql,
    } as unknown as RuntimeClient;

    const result = await runDeploy(
      api,
      { ...baseInputs, testSql: "SELECT 1" },
      { runtimeFactory: () => fakeRuntime },
    );

    expect(probeSql).toHaveBeenCalledWith("SELECT 1");
    expect(result.probeResults).toHaveLength(1);
    expect(result.probeResults[0]?.ok).toBe(false);
  });

  it("skips probes when API key is unavailable but warns when fail-on-test-error=false", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(succeededDeployment);
    const getApiKeys = vi.fn().mockResolvedValue({ api_key: null, api_key_2: null });
    const api = fakeApi({ listApps, createDeployment, getApiKeys });

    const result = await runDeploy(api, {
      ...baseInputs,
      testSql: "SELECT 1",
      failOnTestError: false,
    });
    expect(result.probeResults).toEqual([]);
  });

  it("resolves runtime URL from app cname", () => {
    expect(resolveRuntimeUrl(sampleApp, baseInputs)).toBe(
      "https://us-west-2-prod-aws-data.spiceai.io",
    );
  });

  it("resolves runtime URL from app region when cname is missing", () => {
    expect(resolveRuntimeUrl({ id: 1, name: "x", region: "us-east-1" }, baseInputs)).toBe(
      "https://us-east-1-prod-aws-data.spiceai.io",
    );
  });

  it("respects explicit runtime-url override", () => {
    expect(
      resolveRuntimeUrl(sampleApp, { ...baseInputs, runtimeUrl: "https://custom.example" }),
    ).toBe("https://custom.example");
  });

  it("throws when runtime URL cannot be derived", () => {
    expect(() =>
      resolveRuntimeUrl(
        { id: 1, name: "x" },
        { ...baseInputs, region: undefined, runtimeUrl: undefined },
      ),
    ).toThrow(/Cannot determine runtime URL/);
  });

  it("resolves flight URL by swapping `-data` for `-flight` in the cname", () => {
    expect(resolveFlightUrl(sampleApp, baseInputs)).toBe(
      "us-west-2-prod-aws-flight.spiceai.io:443",
    );
  });

  it("resolves flight URL from app region when cname is missing", () => {
    expect(resolveFlightUrl({ id: 1, name: "x", region: "us-east-1" }, baseInputs)).toBe(
      "us-east-1-prod-aws-flight.spiceai.io:443",
    );
  });

  it("respects explicit flight-url override (with scheme stripping)", () => {
    expect(
      resolveFlightUrl(sampleApp, { ...baseInputs, flightUrl: "custom-flight.example:443" }),
    ).toBe("custom-flight.example:443");
  });

  it("returns undefined when no flight URL can be derived", () => {
    expect(
      resolveFlightUrl(
        { id: 1, name: "x" },
        { ...baseInputs, region: undefined, flightUrl: undefined },
      ),
    ).toBeUndefined();
  });

  it("runs all configured probes in order", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(succeededDeployment);
    const getApiKeys = vi.fn().mockResolvedValue({ api_key: "rk", api_key_2: null });
    const api = fakeApi({ listApps, createDeployment, getApiKeys });

    const calls: string[] = [];
    const fakeRuntime = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
      probeSql: vi.fn().mockImplementation(async () => {
        calls.push("sql");
        return { name: "sql", ok: true, durationMs: 1 };
      }),
      probeNsql: vi.fn().mockImplementation(async () => {
        calls.push("nsql");
        return { name: "nsql", ok: true, durationMs: 1 };
      }),
      probeChat: vi.fn().mockImplementation(async () => {
        calls.push("chat");
        return { name: "chat", ok: true, durationMs: 1 };
      }),
      probeSearch: vi.fn().mockImplementation(async () => {
        calls.push("search");
        return { name: "search", ok: true, durationMs: 1 };
      }),
      probeMcp: vi.fn().mockImplementation(async () => {
        calls.push("mcp");
        return { name: "mcp", ok: true, durationMs: 1 };
      }),
    } as unknown as RuntimeClient;

    await runDeploy(
      api,
      {
        ...baseInputs,
        testSql: "SELECT 1",
        testNsql: "list users",
        testChat: "hi",
        testSearch: '{"datasets":["d"],"text":"x"}',
        testMcpTool: "echo",
      },
      { runtimeFactory: () => fakeRuntime },
    );

    expect(calls).toEqual(["sql", "nsql", "chat", "search", "mcp"]);
  });

  it("waits for datasets before probes and fails when any dataset is in error state", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(succeededDeployment);
    const getApiKeys = vi.fn().mockResolvedValue({ api_key: "rk", api_key_2: null });
    const api = fakeApi({ listApps, createDeployment, getApiKeys });

    const waitForDatasetsReady = vi.fn().mockRejectedValue(
      Object.assign(new Error("1 dataset(s) failed to load: foo: bad creds"), {
        name: "DatasetReadinessError",
        datasets: [{ name: "foo", status: "Error", error_message: "bad creds" }],
      }),
    );
    const probeSql = vi.fn();
    const fakeRuntime = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
      waitForDatasetsReady,
      probeSql,
    } as unknown as RuntimeClient;

    await expect(
      runDeploy(
        api,
        { ...baseInputs, datasetReadyTimeoutSeconds: 60, testSql: "SELECT 1" },
        { runtimeFactory: () => fakeRuntime },
      ),
    ).rejects.toThrow(/dataset.*failed to load/);

    expect(waitForDatasetsReady).toHaveBeenCalledWith(60);
    expect(probeSql).not.toHaveBeenCalled();
  });

  it("dataset readiness failures are fatal even when fail-on-test-error is false", async () => {
    // The opt-out for the dataset check is `dataset-ready-timeout-seconds: 0`.
    // `fail-on-test-error` only governs runtime-probe results.
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(succeededDeployment);
    const getApiKeys = vi.fn().mockResolvedValue({ api_key: "rk", api_key_2: null });
    const api = fakeApi({ listApps, createDeployment, getApiKeys });

    const fakeRuntime = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
      waitForDatasetsReady: vi.fn().mockRejectedValue(
        Object.assign(new Error("1 dataset(s) failed to load: foo: bad creds"), {
          name: "DatasetReadinessError",
          datasets: [{ name: "foo", status: "Error", error_message: "bad creds" }],
        }),
      ),
    } as unknown as RuntimeClient;

    await expect(
      runDeploy(
        api,
        {
          ...baseInputs,
          datasetReadyTimeoutSeconds: 60,
          failOnTestError: false,
        },
        { runtimeFactory: () => fakeRuntime },
      ),
    ).rejects.toThrow(/dataset.*failed to load/);
  });

  it("returns dataset states when all datasets are ready", async () => {
    const listApps = vi.fn().mockResolvedValue([sampleApp]);
    const createDeployment = vi.fn().mockResolvedValue(succeededDeployment);
    const getApiKeys = vi.fn().mockResolvedValue({ api_key: "rk", api_key_2: null });
    const api = fakeApi({ listApps, createDeployment, getApiKeys });

    const datasets = [
      { name: "a", status: "Ready" },
      { name: "b", status: "Ready" },
    ];
    const fakeRuntime = {
      waitForReady: vi.fn().mockResolvedValue(undefined),
      waitForDatasetsReady: vi.fn().mockResolvedValue(datasets),
    } as unknown as RuntimeClient;

    const result = await runDeploy(
      api,
      { ...baseInputs, datasetReadyTimeoutSeconds: 60 },
      { runtimeFactory: () => fakeRuntime },
    );

    expect(result.datasets).toEqual(datasets);
  });
});
