import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveDefaultTags,
  mergeWithDefaultTags,
  parseTags,
  sanitizeTagValue,
} from "../src/tags.js";

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
      expect(parseTags("a: \"alpha-num_v1\"\nb: 'beta-2'")).toEqual({
        a: "alpha-num_v1",
        b: "beta-2",
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

    it("rejects values with characters not allowed by the API", () => {
      // The Spice Cloud API allows only alphanumeric plus `_@-` in tag values.
      expect(() => parseTags("repo: lukekim/home")).toThrow(/letters, numbers, and "_@-"/);
      expect(() => parseTags('env: "prod env"')).toThrow(/letters, numbers, and "_@-"/);
    });

    it("accepts allowed value characters (alphanumeric, underscore, at-sign, hyphen)", () => {
      expect(parseTags("a: foo_bar\nb: foo@bar\nc: foo-bar\nd: AB123")).toEqual({
        a: "foo_bar",
        b: "foo@bar",
        c: "foo-bar",
        d: "AB123",
      });
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

describe("sanitizeTagValue", () => {
  it("replaces disallowed characters with underscore", () => {
    expect(sanitizeTagValue("lukekim/home")).toBe("lukekim_home");
    expect(sanitizeTagValue("foo bar")).toBe("foo_bar");
    expect(sanitizeTagValue("a/b/c")).toBe("a_b_c");
  });

  it("leaves already-valid characters alone", () => {
    expect(sanitizeTagValue("alpha-num_123@v1")).toBe("alpha-num_123@v1");
  });

  it("truncates to 256 characters", () => {
    const big = "a".repeat(300);
    expect(sanitizeTagValue(big)).toHaveLength(256);
  });
});

describe("deriveDefaultTags / mergeWithDefaultTags", () => {
  const ORIGINAL = process.env.GITHUB_REPOSITORY;

  beforeEach(() => {
    delete process.env.GITHUB_REPOSITORY;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = ORIGINAL;
  });

  it("returns no defaults when GITHUB_REPOSITORY is unset", () => {
    expect(deriveDefaultTags({})).toEqual({});
    expect(mergeWithDefaultTags(undefined, {})).toBeUndefined();
  });

  it("auto-captures `repository` from GITHUB_REPOSITORY, sanitizing '/'", () => {
    expect(deriveDefaultTags({ GITHUB_REPOSITORY: "lukekim/home" })).toEqual({
      repository: "lukekim_home",
    });
  });

  it("merges defaults under user-supplied tags (user wins on conflict)", () => {
    const merged = mergeWithDefaultTags(
      { repository: "explicit", env: "prod" },
      { GITHUB_REPOSITORY: "lukekim/home" },
    );
    expect(merged).toEqual({ repository: "explicit", env: "prod" });
  });

  it("returns just the defaults when the user provided no tags", () => {
    expect(mergeWithDefaultTags(undefined, { GITHUB_REPOSITORY: "spicehq/x" })).toEqual({
      repository: "spicehq_x",
    });
  });
});
