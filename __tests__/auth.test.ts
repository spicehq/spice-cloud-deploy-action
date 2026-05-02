import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  setSecret: vi.fn(),
}));

import { OAuthClient } from "../src/auth.js";
import { OAuthError } from "../src/errors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OAuthClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  it("exchanges client credentials for an access token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { access_token: "abc", token_type: "Bearer", expires_in: 3600 }),
      );
    const client = new OAuthClient({
      tokenUrl: "https://oauth.example/token",
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    const token = await client.getAccessToken();
    expect(token).toBe("abc");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "client_credentials",
      client_id: "id",
      client_secret: "secret",
    });
  });

  it("includes scope when provided", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: "t", token_type: "Bearer" }));
    const client = new OAuthClient({
      tokenUrl: "https://oauth.example/token",
      clientId: "id",
      clientSecret: "secret",
      scope: "deployments:write apps:read",
      fetchImpl,
    });

    await client.getAccessToken();
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.scope).toBe("deployments:write apps:read");
  });

  it("caches the token until close to expiry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { access_token: "abc", token_type: "Bearer", expires_in: 60 }),
      );
    const client = new OAuthClient({
      tokenUrl: "https://oauth.example/token",
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    await client.getAccessToken();
    await client.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, { access_token: "xyz", token_type: "Bearer", expires_in: 60 }),
    );
    const next = await client.getAccessToken();
    expect(next).toBe("xyz");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws OAuthError on non-2xx responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("invalid_client", { status: 401, statusText: "Unauthorized" }),
      );
    const client = new OAuthClient({
      tokenUrl: "https://oauth.example/token",
      clientId: "id",
      clientSecret: "wrong",
      fetchImpl,
    });

    await expect(client.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
  });

  it("wraps network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = new OAuthClient({
      tokenUrl: "https://oauth.example/token",
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });
    await expect(client.getAccessToken()).rejects.toMatchObject({
      name: "OAuthError",
      message: expect.stringContaining("ECONNRESET"),
    });
  });
});
