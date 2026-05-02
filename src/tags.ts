import { InputValidationError } from "./errors.js";

const TAG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_:./-]{0,62}$/;

export function parseTags(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;

  const tags: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) {
      throw new InputValidationError(`tags line ${i + 1} is missing "=" — expected KEY=VALUE.`);
    }

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (!TAG_KEY_PATTERN.test(key)) {
      throw new InputValidationError(
        `tags line ${i + 1}: key "${key}" must start with a letter and contain only letters, numbers, and "_:./-".`,
      );
    }
    if (key in tags) {
      throw new InputValidationError(`tags line ${i + 1}: duplicate tag key "${key}".`);
    }
    if (value.length > 256) {
      throw new InputValidationError(
        `tags line ${i + 1}: value for "${key}" exceeds 256 characters.`,
      );
    }
    tags[key] = value;
  }

  return Object.keys(tags).length === 0 ? undefined : tags;
}
