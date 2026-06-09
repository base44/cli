import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config, parse } from "dotenv";
import { PROJECT_SUBDIR } from "@/core/consts.js";
import { readTextFile } from "./fs.js";

export async function parseEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  const content = await readTextFile(filePath);
  return parse(content);
}

// The Stripe Projects CLI namespaces Base44 credentials under this prefix (e.g.
// `BASE44_PROJECTS_BASE44_APP_ID`); the normalizer copies them to the bare name.
const STRIPE_ENV_PREFIX = "BASE44_PROJECTS_";

const BASE44_ENV_KEYS = [
  "BASE44_APP_ID",
  "BASE44_ACCESS_TOKEN",
  "BASE44_REFRESH_TOKEN",
  "BASE44_API_URL",
];

// Project-root markers (mirror PROJECT_CONFIG_PATTERNS). The `.env` lives at the
// root, so we anchor on these to allow running from any subdirectory.
const PROJECT_CONFIG_FILES = ["jsonc", "json"].map((ext) =>
  join(PROJECT_SUBDIR, `config.${ext}`),
);

function findProjectRootSync(startDir: string): string | null {
  let current = startDir;
  while (current !== dirname(current)) {
    if (PROJECT_CONFIG_FILES.some((rel) => existsSync(join(current, rel)))) {
      return current;
    }
    current = dirname(current);
  }
  return null;
}

/**
 * Synchronous so bootstrap can run it before the HTTP clients capture
 * `getBase44ApiUrl()` at module load.
 */
export function loadProjectEnvFiles(cwd: string = process.cwd()): void {
  const root = findProjectRootSync(cwd) ?? cwd;
  // `.env.local` first so it wins (dotenv keeps the first value set per key);
  // ambient `process.env` is never overridden (override defaults to false).
  config({
    path: [join(root, ".env.local"), join(root, ".env")],
    quiet: true,
  });

  normalizeBase44Env();
}

function normalizeBase44Env(): void {
  for (const bareKey of BASE44_ENV_KEYS) {
    if (process.env[bareKey] !== undefined) {
      continue;
    }

    const prefixed = process.env[`${STRIPE_ENV_PREFIX}${bareKey}`];
    if (prefixed !== undefined) {
      process.env[bareKey] = prefixed;
    }
  }
}
