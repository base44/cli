import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PROJECT_SUBDIR } from "./consts.js";
import { findProjectRoot } from "./project/index.js";

// After bundling, import.meta.url points to dist/cli/index.js
// Templates are copied to dist/cli/templates/
const __dirname = dirname(fileURLToPath(import.meta.url));

export function getBase44GlobalDir(): string {
  return join(homedir(), ".base44");
}

export function getAuthFilePath(): string {
  return join(getBase44GlobalDir(), "auth", "auth.json");
}

export function getTemplatesDir(): string {
  return join(__dirname, "templates");
}

export function getTemplatesIndexPath(): string {
  return join(getTemplatesDir(), "templates.json");
}

/**
 * Load .env.local from the project root if it exists.
 * Values won't override existing process.env variables.
 */
export async function loadProjectEnv(projectRoot?: string): Promise<void> {
  const found = projectRoot ? { root: projectRoot } : await findProjectRoot();

  if (!found) {
    return;
  }

  const envPath = join(found.root, PROJECT_SUBDIR, ".env.local");
  config({ path: envPath, override: false, quiet: true });
}

export function getBase44ApiUrl(): string {
  return process.env.BASE44_API_URL || "https://app.base44.com";
}

export function getBase44ClientId(): string | undefined {
  return process.env.BASE44_CLIENT_ID;
}
