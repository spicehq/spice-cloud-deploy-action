import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readInputs } from "../src/inputs.js";

const TRACKED_ENV = ["GITHUB_REF_NAME", "GITHUB_SHA"];

function setInputs(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    process.env[`INPUT_${key.replace(/ /g, "_").toUpperCase()}`] = value;
  }
}

function clearInputs() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("INPUT_")) delete process.env[key];
  }
  for (const key of TRACKED_ENV) {
    delete process.env[key];
  }
}

beforeEach(() => {
  clearInputs();
});

afterEach(() => {
  clearInputs();
});

describe("readInputs", () => {
  it("reads required client credentials and resolves defaults", () => {
    process.env.GITHUB_REF_NAME = "main";
    process.env.GITHUB_SHA = "abc123";
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-name": "demo",
    });

    const inputs = readInputs();
    expect(inputs.clientId).toBe("id");
    expect(inputs.clientSecret).toBe("secret");
    expect(inputs.appName).toBe("demo");
    expect(inputs.branch).toBe("main");
    expect(inputs.commitSha).toBe("abc123");
    expect(inputs.apiUrl).toBe("https://api.spice.ai");
    expect(inputs.oauthTokenUrl).toBe("https://spice.ai/api/oauth/token");
    expect(inputs.waitForCompletion).toBe(true);
    expect(inputs.timeoutSeconds).toBe(600);
    expect(inputs.region).toBeUndefined();
  });

  it("requires either app-id or app-name", () => {
    setInputs({ "client-id": "id", "client-secret": "secret" });
    expect(() => readInputs()).toThrow(/Either "app-id" or "app-name"/);
  });

  it("rejects invalid replicas range", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-name": "demo",
      replicas: "11",
    });
    expect(() => readInputs()).toThrow(/replicas/);
  });

  it("rejects unknown channel", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-name": "demo",
      channel: "experimental",
    });
    expect(() => readInputs()).toThrow(/channel/);
  });

  it("rejects non-positive app-id", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-id": "0",
    });
    expect(() => readInputs()).toThrow(/app-id/);
  });

  it("trims trailing slash from URLs", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-name": "demo",
      "api-url": "https://api.example.com/",
    });
    expect(readInputs().apiUrl).toBe("https://api.example.com");
  });

  it("requires app-name when create-app-if-missing is true", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-id": "1",
      "create-app-if-missing": "true",
      region: "us-west-2",
    });
    expect(() => readInputs()).toThrow(/create-app-if-missing/);
  });

  it("requires region when create-app-if-missing is true", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-name": "demo",
      "create-app-if-missing": "true",
    });
    expect(() => readInputs()).toThrow(/region/);
  });

  it("rejects region values that don't look like an AWS region", () => {
    setInputs({
      "client-id": "id",
      "client-secret": "secret",
      "app-name": "demo",
      region: "USWEST",
    });
    expect(() => readInputs()).toThrow(/region/);
  });
});
