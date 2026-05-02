import { describe, expect, it } from "vitest";
import { parseTags } from "../src/tags.js";

describe("parseTags", () => {
  it("returns undefined when input is empty", () => {
    expect(parseTags(undefined)).toBeUndefined();
    expect(parseTags("")).toBeUndefined();
    expect(parseTags("\n# only comments\n")).toBeUndefined();
  });

  it("parses KEY=VALUE pairs", () => {
    expect(parseTags("environment=production\nteam=data\n")).toEqual({
      environment: "production",
      team: "data",
    });
  });

  it("preserves '=' inside values", () => {
    expect(parseTags("url=https://x.com?a=1")).toEqual({ url: "https://x.com?a=1" });
  });

  it("rejects keys that don't start with a letter", () => {
    expect(() => parseTags("1foo=bar")).toThrow(/start with a letter/);
  });

  it("rejects duplicate keys", () => {
    expect(() => parseTags("env=a\nenv=b")).toThrow(/duplicate tag key/);
  });

  it("rejects values longer than 256 chars", () => {
    const long = "x".repeat(257);
    expect(() => parseTags(`big=${long}`)).toThrow(/exceeds 256/);
  });
});
