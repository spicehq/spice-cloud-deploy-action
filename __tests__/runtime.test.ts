import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  setSecret: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@spiceai/spice", () => ({
  SpiceClient: vi.fn(),
}));

import type { SdkLike } from "../src/runtime.js";
import { RuntimeClient } from "../src/runtime.js";

function makeSdk(overrides: Partial<SdkLike> = {}): SdkLike {
  return {
    isSpiceReady: vi.fn().mockResolvedValue(true),
    sqlJson: vi.fn().mockResolvedValue({ row_count: 0, data: [] }),
    nsql: vi.fn().mockResolvedValue({ row_count: 0, data: [], sql: "SELECT 1" }),
    ...overrides,
  };
}

function makeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("RuntimeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately when warmup is 0", async () => {
    const sdk = makeSdk();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => sdk,
    });
    await rt.waitForReady();
    expect(sdk.isSpiceReady).not.toHaveBeenCalled();
  });

  it("polls isSpiceReady until ready", async () => {
    const isReady = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const sdk = makeSdk({ isSpiceReady: isReady });
    const clock = makeClock();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 30,
      timeoutSeconds: 5,
      sdkFactory: () => sdk,
      clock,
    });
    await rt.waitForReady();
    expect(isReady).toHaveBeenCalledTimes(3);
  });

  it("throws when warmup deadline elapses", async () => {
    const sdk = makeSdk({ isSpiceReady: vi.fn().mockResolvedValue(false) });
    const clock = makeClock();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 5,
      timeoutSeconds: 5,
      sdkFactory: () => sdk,
      clock,
    });
    await expect(rt.waitForReady()).rejects.toThrow(/Runtime not ready/);
  });

  it("probeSql succeeds and returns row count detail", async () => {
    const sqlJson = vi.fn().mockResolvedValue({ row_count: 3, execution_time_ms: 17 });
    const sdk = makeSdk({ sqlJson });
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => sdk,
    });
    const result = await rt.probeSql("SELECT 1");
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("3 row(s)");
    expect(sqlJson).toHaveBeenCalledWith("SELECT 1");
  });

  it("probeSql captures errors", async () => {
    const sdk = makeSdk({ sqlJson: vi.fn().mockRejectedValue(new Error("boom")) });
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => sdk,
    });
    const result = await rt.probeSql("SELECT 1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
  });

  it("probeNsql passes model option through", async () => {
    const nsql = vi.fn().mockResolvedValue({ row_count: 1, sql: "SELECT now()" });
    const sdk = makeSdk({ nsql });
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => sdk,
    });
    const result = await rt.probeNsql("rows please", "nql");
    expect(nsql).toHaveBeenCalledWith("rows please", { model: "nql" });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("SELECT now()");
  });

  it("probeChat issues a POST to /v1/chat/completions with bearer auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello world" } }],
          usage: { total_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
    });
    const result = await rt.probeChat({ messages: [{ role: "user", content: "hi" }] });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("7 tokens");
    expect(result.detail).toContain("hello world");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://data.spiceai.io/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("getDatasets requests /v1/datasets?status=true with x-api-key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ name: "a", status: "Ready" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://us-west-2-prod-aws-data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
    });
    const result = await rt.getDatasets();
    expect(result).toEqual([{ name: "a", status: "Ready" }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://us-west-2-prod-aws-data.spiceai.io/v1/datasets?status=true");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });

  it("waitForDatasetsReady returns once all datasets are ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { name: "a", status: "Initializing" },
            { name: "b", status: "Ready" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { name: "a", status: "Ready" },
            { name: "b", status: "Ready" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const clock = makeClock();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://x.example",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
      clock,
    });
    const datasets = await rt.waitForDatasetsReady(60);
    expect(datasets.every((d) => d.status === "Ready")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waitForDatasetsReady throws DatasetReadinessError on error state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ name: "a", status: "Error", error_message: "auth failed" }]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://x.example",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
    });
    await expect(rt.waitForDatasetsReady(60)).rejects.toMatchObject({
      name: "DatasetReadinessError",
      message: expect.stringContaining("auth failed"),
    });
  });

  it("waitForDatasetsReady throws on timeout while still initializing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ name: "a", status: "Initializing" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const clock = makeClock();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://x.example",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
      clock,
    });
    await expect(rt.waitForDatasetsReady(5)).rejects.toThrow(/did not finish loading/);
  });

  it("waitForDatasetsReady accepts disabled and refreshing as terminal-ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: "a", status: "Ready" },
          { name: "b", status: "Disabled" },
          { name: "c", status: "Refreshing" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://x.example",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
    });
    const datasets = await rt.waitForDatasetsReady(60);
    expect(datasets.map((d) => d.name)).toEqual(["a", "b", "c"]);
  });

  it("waitForDatasetsReady treats shuttingdown and unknown statuses as still-pending (does not return early)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: "a", status: "Ready" },
          { name: "b", status: "ShuttingDown" },
          { name: "c", status: "QuantumFlux" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const clock = makeClock();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://x.example",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
      clock,
    });
    await expect(rt.waitForDatasetsReady(5)).rejects.toThrow(
      /did not finish loading.*ShuttingDown.*QuantumFlux/s,
    );
  });

  it("waitForDatasetsReady is a no-op when timeout is 0", async () => {
    const fetchImpl = vi.fn();
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://x.example",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
    });
    expect(await rt.waitForDatasetsReady(0)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("probeSearch reports failures with body context", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("upstream timeout", { status: 504, statusText: "Gateway Timeout" }),
      );
    const rt = new RuntimeClient({
      apiKey: "k",
      baseUrl: "https://data.spiceai.io",
      warmupSeconds: 0,
      timeoutSeconds: 5,
      sdkFactory: () => makeSdk(),
      fetchImpl,
    });
    const result = await rt.probeSearch({ datasets: ["x"], text: "y" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("504");
    expect(result.error).toContain("upstream timeout");
  });
});
