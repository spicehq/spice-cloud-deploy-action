import * as core from "@actions/core";
import { InputValidationError } from "./errors.js";

export interface ParsedSecret {
  name: string;
  value: string;
}

const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseSecrets(raw: string | undefined): ParsedSecret[] {
  if (!raw) return [];

  const results: ParsedSecret[] = [];
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) {
      throw new InputValidationError(`secrets line ${i + 1} is missing "=" — expected KEY=VALUE.`);
    }

    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);

    if (!SECRET_NAME_PATTERN.test(name)) {
      throw new InputValidationError(
        `secrets line ${i + 1}: name "${name}" must start with a letter or underscore and contain only letters, numbers, and underscores.`,
      );
    }
    if (seen.has(name)) {
      throw new InputValidationError(`secrets line ${i + 1}: duplicate secret "${name}".`);
    }
    seen.add(name);

    if (value !== "") core.setSecret(value);
    results.push({ name, value });
  }

  return results;
}
