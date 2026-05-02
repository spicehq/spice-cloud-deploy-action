import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import * as core from "@actions/core";

export interface SpicepodFile {
  resolvedPath: string;
  contents: string;
}

const MAX_BYTES = 1_000_000;

export function readSpicepod(
  spicepodPath: string,
  workingDirectory: string,
): SpicepodFile | undefined {
  const resolved = isAbsolute(spicepodPath)
    ? spicepodPath
    : resolve(workingDirectory, spicepodPath);

  if (!existsSync(resolved)) {
    core.info(`No spicepod manifest at ${resolved}; skipping app spicepod update.`);
    return undefined;
  }

  const stat = statSync(resolved);
  if (!stat.isFile()) {
    core.warning(`Spicepod path ${resolved} is not a regular file; skipping.`);
    return undefined;
  }
  if (stat.size > MAX_BYTES) {
    core.warning(
      `Spicepod manifest ${resolved} is ${stat.size} bytes (> ${MAX_BYTES}); skipping upload.`,
    );
    return undefined;
  }

  const contents = readFileSync(resolved, "utf8");
  return { resolvedPath: resolved, contents };
}
