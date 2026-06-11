import { basename, dirname, join } from "node:path";
import { config, parse } from "dotenv";
import { BASE44_APP_ID_ENV_VAR, PROJECT_SUBDIR } from "@/core/consts.js";
import { findProjectRoot } from "@/core/project/find-root.js";
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
  BASE44_APP_ID_ENV_VAR,
  "BASE44_ACCESS_TOKEN",
  "BASE44_REFRESH_TOKEN",
  "BASE44_API_URL",
];

// The project root is where `.env` and the `base44/` config dir live; derive it
// from the located config (its parent, or one level up when it sits in base44/)
// so commands work from the root or any subdirectory. findProjectRoot is
// sync/light, so this is safe to call at bootstrap.
function findEnvDir(cwd: string): string {
  const found = findProjectRoot(cwd);
  if (!found) {
    return cwd;
  }
  const configDir = dirname(found.configPath);
  return basename(configDir) === PROJECT_SUBDIR
    ? dirname(configDir)
    : configDir;
}

export function loadProjectEnvFiles(cwd: string = process.cwd()): void {
  const root = findEnvDir(cwd);
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
