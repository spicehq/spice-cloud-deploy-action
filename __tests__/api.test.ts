import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  setSecret: vi.fn(),
  warning: vi.fn(),
}));

import { SpiceApiClient } from "../src/api.js";
import { OAuthClient } from "../src/auth.js";
import { SpiceApiError } from "../src/errors.js";

function makeOAuth(token = "tok"): OAuthClient {
  const client = new OAuthClient({
    tokenUrl: "https://oauth/token",
    clientId: "id",
    clientSecret: "secret",
    fetchImpl: vi.fn(),
  });
  vi.spyOn(client, "getAccessToken").mockResolvedValue(token);
  return client;
}

describe("SpiceApiClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends Bearer token and parses JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ apps: [{ id: 1, name: "a" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const api = new SpiceApiClient({
      baseUrl: "https://api.spice.ai",
      oauth: makeOAuth("hello"),
      fetchImpl,
    });

    const apps = await api.listApps();
    expect(apps).toEqual([{ id: 1, name: "a" }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.spice.ai/v1/apps");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hello");
  });

  it("retries on 503 and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow", { status: 503, statusText: "unavailable" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ apps: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const api = new SpiceApiClient({
      baseUrl: "https://api.spice.ai",
      oauth: makeOAuth(),
      fetchImpl,
      retry: { maxAttempts: 3, initialDelayMs: 1 },
    });

    const promise = api.listApps();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx (besides 408/429)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "App not found" }), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" },
      }),
    );
    const api = new SpiceApiClient({
      baseUrl: "https://api.spice.ai",
      oauth: makeOAuth(),
      fetchImpl,
      retry: { maxAttempts: 3, initialDelayMs: 1 },
    });

    await expect(api.getApp(99)).rejects.toBeInstanceOf(SpiceApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("formats fieldErrors into a useful message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Validation failed",
          details: { fieldErrors: { name: ["must be at least 4 chars"] } },
        }),
        { status: 400, statusText: "Bad Request", headers: { "content-type": "application/json" } },
      ),
    );
    const api = new SpiceApiClient({
      baseUrl: "https://api.spice.ai",
      oauth: makeOAuth(),
      fetchImpl,
      retry: { maxAttempts: 1, initialDelayMs: 1 },
    });

    await expect(api.createApp({ name: "x" })).rejects.toMatchObject({
      message: expect.stringContaining("must be at least 4 chars"),
    });
  });

  it("honours Retry-After header (seconds)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ apps: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const api = new SpiceApiClient({
      baseUrl: "https://api.spice.ai",
      oauth: makeOAuth(),
      fetchImpl,
      retry: { maxAttempts: 3, initialDelayMs: 1 },
    });

    const promise = api.listApps();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
