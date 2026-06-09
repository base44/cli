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

// Project-local env files loaded at CLI startup, in increasing precedence order
// (a later file overrides an earlier one for the same key).
const PROJECT_ENV_FILES = [".env", ".env.local"];

// The credentials the CLI consumes from the environment. The Stripe Projects
// CLI namespaces these by resource (e.g. BASE44_PROJECTS_BASE44_APP_ID), so we
// also accept any `<PREFIX>_BASE44_*` form and normalize it to the bare name.
const BASE44_ENV_KEYS = [
  "BASE44_APP_ID",
  "BASE44_ACCESS_TOKEN",
  "BASE44_REFRESH_TOKEN",
  "BASE44_API_URL",
];

/**
 * Loads project-local `.env` / `.env.local` files into `process.env`.
 *
 * Enables non-interactive handoff flows such as the Stripe Projects CLI, which
 * writes the Base44 credentials to `.env` via `stripe projects env --pull`.
 * Loading them here lets `base44` commands pick up those credentials with no
 * wrapper.
 *
 * Precedence: ambient/explicit `process.env` > `.env.local` > `.env`. Values
 * already present in the environment are never overridden. Missing files are
 * ignored. Synchronous so it can run during program bootstrap before parsing.
 */
export function loadProjectEnvFiles(cwd: string = process.cwd()): void {
  const merged: Record<string, string> = {};

  for (const fileName of PROJECT_ENV_FILES) {
    try {
      const content = readFileSync(join(cwd, fileName), "utf-8");
      Object.assign(merged, parse(content));
    } catch {
      // File missing or unreadable — skip it.
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
 * Bridges the Stripe Projects CLI's namespaced credential vars to the bare
 * `BASE44_*` names the rest of the CLI reads.
 *
 * `stripe projects env --pull` prefixes each provider var with the resource
 * name, so the access token arrives as e.g. `BASE44_PROJECTS_BASE44_ACCESS_TOKEN`
 * rather than `BASE44_ACCESS_TOKEN`. For each expected key, if the bare name is
 * unset and exactly one `<PREFIX>_<KEY>` variable exists, copy its value to the
 * bare name. Ambiguous (multiple matches) or missing keys are left untouched so
 * resolution fails with a clear error instead of picking the wrong credential.
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
