import { describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  setSecret: vi.fn(),
}));

import { parseSecrets } from "../src/secrets.js";

describe("parseSecrets", () => {
  it("returns an empty array for empty input", () => {
    expect(parseSecrets(undefined)).toEqual([]);
    expect(parseSecrets("")).toEqual([]);
    expect(parseSecrets("\n  \n")).toEqual([]);
    expect(parseSecrets("{}")).toEqual([]);
  });

  describe("YAML block-map form", () => {
    it("parses KEY: VALUE lines", () => {
      expect(parseSecrets("FOO: bar\nBAZ: qux\n")).toEqual([
        { name: "FOO", value: "bar" },
        { name: "BAZ", value: "qux" },
      ]);
    });

    it("preserves any character (incl. ':' '=' '/') inside the value", () => {
      // Splits on the first ':' only. Values are otherwise unrestricted.
      expect(parseSecrets("URL: https://x.com:8080?a=1&b=2!@#$%^&*()")).toEqual([
        { name: "URL", value: "https://x.com:8080?a=1&b=2!@#$%^&*()" },
      ]);
    });

    it("strips matching single or double quotes around values", () => {
      expect(parseSecrets("A: \"with spaces and : colons\"\nB: 'special !@#$ chars'")).toEqual([
        { name: "A", value: "with spaces and : colons" },
        { name: "B", value: "special !@#$ chars" },
      ]);
    });

    it("ignores blank lines and #-comment lines", () => {
      expect(parseSecrets("\n# header\nFOO: bar\n  # indented\nBAZ: qux")).toEqual([
        { name: "FOO", value: "bar" },
        { name: "BAZ", value: "qux" },
      ]);
    });

    it("rejects lines without ':'", () => {
      expect(() => parseSecrets("FOO\nBAR: baz")).toThrow(/expected "KEY: VALUE"/);
    });

    it("rejects names that don't match the API pattern", () => {
      expect(() => parseSecrets("1FOO: x")).toThrow(/start with a letter or underscore/);
      expect(() => parseSecrets("FOO-BAR: x")).toThrow(/letters, numbers, and underscores/);
    });

    it("rejects duplicate names", () => {
      expect(() => parseSecrets("FOO: a\nFOO: b")).toThrow(/duplicate secret "FOO"/);
    });

    it("allows empty values without crashing", () => {
      expect(parseSecrets("EMPTY: ")).toEqual([{ name: "EMPTY", value: "" }]);
    });
  });

  describe("JSON object form", () => {
    it("parses a JSON object", () => {
      expect(parseSecrets('{"FOO":"bar","BAZ":"qux"}')).toEqual([
        { name: "FOO", value: "bar" },
        { name: "BAZ", value: "qux" },
      ]);
    });

    it("preserves any string value", () => {
      expect(parseSecrets('{"URL":"https://x.com:8080?a=1&b=2!@#"}')).toEqual([
        { name: "URL", value: "https://x.com:8080?a=1&b=2!@#" },
      ]);
    });

    it("rejects malformed JSON that begins with {", () => {
      expect(() => parseSecrets("{ not json")).toThrow(/not valid JSON/);
    });

    it("rejects non-string JSON values", () => {
      expect(() => parseSecrets('{"REPLICAS":3}')).toThrow(/must be a string/);
    });

    it("rejects JSON keys that don't match the API pattern", () => {
      expect(() => parseSecrets('{"1FOO":"x"}')).toThrow(/start with a letter or underscore/);
    });
  });
});
