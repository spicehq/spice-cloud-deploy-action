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
  });

  it("parses KEY=VALUE pairs across lines", () => {
    const result = parseSecrets("FOO=bar\nBAZ=qux quux\n");
    expect(result).toEqual([
      { name: "FOO", value: "bar" },
      { name: "BAZ", value: "qux quux" },
    ]);
  });

  it("preserves '=' inside the value", () => {
    expect(parseSecrets("URL=https://x.com?a=1&b=2")).toEqual([
      { name: "URL", value: "https://x.com?a=1&b=2" },
    ]);
  });

  it("ignores blank lines and comments", () => {
    const result = parseSecrets("\n# a comment\nFOO=bar\n   # indented comment\nBAZ=qux\n");
    expect(result).toEqual([
      { name: "FOO", value: "bar" },
      { name: "BAZ", value: "qux" },
    ]);
  });

  it("rejects lines without '='", () => {
    expect(() => parseSecrets("FOO\nBAR=baz")).toThrow(/missing "="/);
  });

  it("rejects names that don't match the API pattern", () => {
    expect(() => parseSecrets("1FOO=x")).toThrow(/must start with a letter or underscore/);
    expect(() => parseSecrets("FOO-BAR=x")).toThrow(/letters, numbers, and underscores/);
  });

  it("rejects duplicate names", () => {
    expect(() => parseSecrets("FOO=a\nFOO=b")).toThrow(/duplicate secret "FOO"/);
  });

  it("allows empty values without crashing", () => {
    expect(parseSecrets("EMPTY=")).toEqual([{ name: "EMPTY", value: "" }]);
  });
});
