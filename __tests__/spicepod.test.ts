import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import { readSpicepod } from "../src/spicepod.js";

describe("readSpicepod", () => {
  it("returns undefined when the file is missing", () => {
    expect(readSpicepod("nope.yaml", tmpdir())).toBeUndefined();
  });

  it("reads file contents using working directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "spice-"));
    writeFileSync(join(dir, "spicepod.yaml"), "version: v1");
    const result = readSpicepod("spicepod.yaml", dir);
    expect(result?.contents).toBe("version: v1");
    expect(result?.resolvedPath).toBe(join(dir, "spicepod.yaml"));
  });

  it("respects absolute paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "spice-"));
    const file = join(dir, "manifest.yaml");
    writeFileSync(file, "name: app");
    const result = readSpicepod(file, "/should/be/ignored");
    expect(result?.resolvedPath).toBe(file);
  });

  it("skips directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "spice-"));
    mkdirSync(join(dir, "spicepod.yaml"));
    expect(readSpicepod("spicepod.yaml", dir)).toBeUndefined();
  });
});
