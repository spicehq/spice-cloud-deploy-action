import * as core from "@actions/core";
import { InputValidationError } from "./errors.js";

export interface ParsedSecret {
  name: string;
  value: string;
}

const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse the `secrets` input into a list of `{ name, value }` pairs and mask
 * each non-empty value via `core.setSecret` so it doesn't appear in logs.
 *
 * Accepted forms:
 *   - JSON object:        `{"OPENAI_API_KEY":"sk-...","PG_PASSWORD":"..."}`
 *   - YAML block mapping (one `KEY: VALUE` per line — the canonical form):
 *
 *       OPENAI_API_KEY: sk-...
 *       PG_PASSWORD: hunter2
 *
 * Lines beginning with `#` (after optional whitespace) are treated as comments.
 * Values may be wrapped in matching single or double quotes; quotes are
 * stripped. Unlike tag values, secret values can contain any characters —
 * only the secret name has format constraints (matches the Spice Cloud API:
 * starts with a letter or underscore, alphanumeric + underscore thereafter).
 */
export function parseSecrets(raw: string | undefined): ParsedSecret[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const entries = trimmed.startsWith("{") ? parseJsonObject(trimmed) : parseBlockMap(trimmed);
  for (const { value } of entries) {
    if (value !== "") core.setSecret(value);
  }
  return entries;
}

function parseJsonObject(raw: string): ParsedSecret[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InputValidationError(
      `secrets: input starts with "{" but is not valid JSON — ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InputValidationError(
      `secrets: JSON value must be a flat object of string -> string.`,
    );
  }

  const out: ParsedSecret[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    validateName(name, "secrets");
    if (typeof value !== "string") {
      throw new InputValidationError(
        `secrets: value for "${name}" must be a string (got ${typeof value}).`,
      );
    }
    out.push({ name, value });
  }
  return out;
}

function parseBlockMap(raw: string): ParsedSecret[] {
  const out: ParsedSecret[] = [];
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colon = line.indexOf(":");
    if (colon === -1) {
      throw new InputValidationError(
        `secrets line ${i + 1}: expected "KEY: VALUE" (got "${line.trim()}").`,
      );
    }

    const name = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());

    validateName(name, `secrets line ${i + 1}`);
    if (seen.has(name)) {
      throw new InputValidationError(`secrets line ${i + 1}: duplicate secret "${name}".`);
    }
    seen.add(name);
    out.push({ name, value });
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

function validateName(name: string, context: string): void {
  if (!SECRET_NAME_PATTERN.test(name)) {
    throw new InputValidationError(
      `${context}: secret name "${name}" must start with a letter or underscore and contain only letters, numbers, and underscores.`,
    );
  }
}
