import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { readTextFile } from "./fs.js";

/**
 * Parse a .env file into a Record of key-value pairs.
 */
export async function parseEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  const content = await readTextFile(filePath);
  return parse(content);
}

// Loaded at startup in increasing precedence (.env.local overrides .env).
const PROJECT_ENV_FILES = [".env", ".env.local"];

// Credentials the CLI reads from the environment. Some tools namespace these
// behind a prefix (e.g. `<PREFIX>_BASE44_APP_ID`), so the normalizer also
// accepts a `<PREFIX>_<KEY>` form.
const BASE44_ENV_KEYS = [
  "BASE44_APP_ID",
  "BASE44_ACCESS_TOKEN",
  "BASE44_REFRESH_TOKEN",
  "BASE44_API_URL",
];

/**
 * Loads project-local `.env` / `.env.local` into `process.env` so non-interactive
 * flows that write credentials to `.env` work with no wrapper.
 *
 * Precedence: ambient `process.env` > `.env.local` > `.env` (existing values are
 * never overridden). Synchronous so it can run during bootstrap, before the HTTP
 * clients capture `getBase44ApiUrl()`.
 */
export function loadProjectEnvFiles(cwd: string = process.cwd()): void {
  const merged: Record<string, string> = {};

  for (const fileName of PROJECT_ENV_FILES) {
    try {
      const content = readFileSync(join(cwd, fileName), "utf-8");
      Object.assign(merged, parse(content));
    } catch {
      // Missing/unreadable file — skip.
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  normalizeBase44Env();
}

/**
 * Copies a prefix-namespaced credential var (e.g. `<PREFIX>_BASE44_APP_ID`) to
 * its bare `BASE44_*` name. Acts only when the bare name is unset and exactly
 * one `<PREFIX>_<KEY>` match exists — ambiguous or missing keys are left
 * untouched so resolution fails clearly rather than picking the wrong credential.
 */
function normalizeBase44Env(): void {
  for (const bareKey of BASE44_ENV_KEYS) {
    if (process.env[bareKey] !== undefined) {
      continue;
    }

    const suffix = `_${bareKey}`;
    const matches = Object.keys(process.env).filter(
      (key) => key !== bareKey && key.endsWith(suffix),
    );

    if (matches.length === 1) {
      process.env[bareKey] = process.env[matches[0]];
    }
  }
}
