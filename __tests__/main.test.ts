import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  setSecret: vi.fn(),
  info: vi.fn(),
  summary: { addHeading: vi.fn(), addTable: vi.fn(), write: vi.fn() },
}));

import { buildAppUrl } from "../src/main.js";

describe("buildAppUrl", () => {
  const ORIGINAL = process.env.GITHUB_REPOSITORY;

  beforeEach(() => {
    delete process.env.GITHUB_REPOSITORY;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = ORIGINAL;
  });

  it("uses the explicit org input when provided", () => {
    expect(buildAppUrl("home", "lukekim")).toBe("https://spice.ai/lukekim/home");
  });

  it("falls back to the owner part of GITHUB_REPOSITORY", () => {
    process.env.GITHUB_REPOSITORY = "lukekim/home";
    expect(buildAppUrl("home", undefined)).toBe("https://spice.ai/lukekim/home");
  });

  it("prefers the explicit org over GITHUB_REPOSITORY", () => {
    process.env.GITHUB_REPOSITORY = "github-org/repo";
    expect(buildAppUrl("home", "spice-org")).toBe("https://spice.ai/spice-org/home");
  });

  it("falls back to the apps listing when no org is available", () => {
    expect(buildAppUrl("home", undefined)).toBe("https://spice.ai/apps");
  });
});
