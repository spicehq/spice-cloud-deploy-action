import { InputValidationError } from "./errors.js";

const TAG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_./-]{0,62}$/;
const MAX_VALUE_LENGTH = 256;

/**
 * Parse the `tags` input into a flat `Record<string, string>`.
 *
 * Accepted forms:
 *   - JSON object:        `{"environment":"production","team":"data"}`
 *   - YAML block mapping (one `key: value` per line — the canonical form):
 *
 *       environment: production
 *       team: data-platform
 *       commit: abc123
 *
 * Lines beginning with `#` (after optional whitespace) are treated as comments.
 * Values may be optionally wrapped in single or double quotes; quotes are stripped.
 */
export function parseTags(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const tags = trimmed.startsWith("{") ? parseJsonObject(trimmed) : parseBlockMap(trimmed);
  return Object.keys(tags).length === 0 ? undefined : tags;
}

function parseJsonObject(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InputValidationError(
      `tags: input starts with "{" but is not valid JSON — ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InputValidationError(`tags: JSON value must be a flat object of string -> string.`);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    validateKey(key, "tags");
    if (typeof value !== "string") {
      throw new InputValidationError(
        `tags: value for "${key}" must be a string (got ${typeof value}).`,
      );
    }
    validateValue(key, value);
    out[key] = value;
  }
  return out;
}

function parseBlockMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colon = line.indexOf(":");
    if (colon === -1) {
      throw new InputValidationError(
        `tags line ${i + 1}: expected "key: value" (got "${line.trim()}").`,
      );
    }

    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());

    validateKey(key, `tags line ${i + 1}`);
    if (Object.hasOwn(out, key)) {
      throw new InputValidationError(`tags line ${i + 1}: duplicate tag key "${key}".`);
    }
    validateValue(key, value);
    out[key] = value;
  }

  return out;
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function validateKey(key: string, context: string): void {
  if (!TAG_KEY_PATTERN.test(key)) {
    throw new InputValidationError(
      `${context}: key "${key}" must start with a letter and contain only letters, numbers, and "_./-" (max 63 chars).`,
    );
  }
}

function validateValue(key: string, value: string): void {
  if (value.length > MAX_VALUE_LENGTH) {
    throw new InputValidationError(
      `tags: value for "${key}" exceeds ${MAX_VALUE_LENGTH} characters.`,
    );
  }
}
