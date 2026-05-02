import { describe, expect, it } from "vitest";
import { parseTags } from "../src/tags.js";

describe("parseTags", () => {
  it("returns undefined for empty input", () => {
    expect(parseTags(undefined)).toBeUndefined();
    expect(parseTags("")).toBeUndefined();
    expect(parseTags("\n# only comments\n")).toBeUndefined();
    expect(parseTags("{}")).toBeUndefined();
  });

  describe("YAML block-map form", () => {
    it("parses key: value lines", () => {
      expect(parseTags("environment: production\nteam: data\n")).toEqual({
        environment: "production",
        team: "data",
      });
    });

    it("trims whitespace around keys and values", () => {
      expect(parseTags("  environment :   production  ")).toEqual({
        environment: "production",
      });
    });

    it("strips matching single or double quotes around values", () => {
      expect(parseTags("a: \"with spaces\"\nb: 'single quoted'")).toEqual({
        a: "with spaces",
        b: "single quoted",
      });
    });

    it("preserves a single colon inside the value", () => {
      expect(parseTags("url: https://example.com:8080/x")).toEqual({
        url: "https://example.com:8080/x",
      });
    });

    it("ignores blank lines and #-comment lines", () => {
      expect(parseTags("\n# header\nfoo: 1\n\n  # inline comment\nbar: 2")).toEqual({
        foo: "1",
        bar: "2",
      });
    });

    it("rejects lines without a colon", () => {
      expect(() => parseTags("not-a-map")).toThrow(/expected "key: value"/);
    });

    it("rejects keys that don't start with a letter", () => {
      expect(() => parseTags("1foo: bar")).toThrow(/start with a letter/);
    });

    it("rejects duplicate keys", () => {
      expect(() => parseTags("env: a\nenv: b")).toThrow(/duplicate tag key/);
    });

    it("does not treat Object.prototype property names as duplicates", () => {
      // Regression: `if (key in out)` would falsely flag built-in property
      // names like `toString` or `constructor` as duplicates on first use.
      expect(parseTags("toString: bar\nconstructor: baz")).toEqual({
        toString: "bar",
        constructor: "baz",
      });
    });

    it("rejects values longer than 256 chars", () => {
      const long = "x".repeat(257);
      expect(() => parseTags(`big: ${long}`)).toThrow(/exceeds 256/);
    });
  });

  describe("JSON object form", () => {
    it("parses a JSON object", () => {
      expect(parseTags('{"environment":"production","team":"data"}')).toEqual({
        environment: "production",
        team: "data",
      });
    });

    it("rejects malformed JSON that begins with {", () => {
      expect(() => parseTags("{ not json")).toThrow(/not valid JSON/);
    });

    it("rejects non-string JSON values (e.g. an array under a key)", () => {
      expect(() => parseTags('{"tags":["a","b"]}')).toThrow(/must be a string/);
    });

    it("treats a root-level JSON array as YAML and rejects it as malformed", () => {
      // A literal `[…]` at the root doesn't start with `{`, so the parser
      // falls through to the block-map path, where it's rejected because the
      // first non-empty line lacks a "key: value" separator.
      expect(() => parseTags('["a","b"]')).toThrow(/expected "key: value"/);
    });

    it("rejects JSON values that aren't strings", () => {
      expect(() => parseTags('{"replicas":3}')).toThrow(/must be a string/);
    });

    it("rejects JSON keys with invalid characters", () => {
      expect(() => parseTags('{"1bad":"x"}')).toThrow(/start with a letter/);
    });

    it("rejects JSON keys containing ':' (would conflict with the YAML separator)", () => {
      expect(() => parseTags('{"foo:bar":"value"}')).toThrow(/letters, numbers, and "_\.\/-"/);
    });
  });
});
