import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { PROJECT_SUBDIR } from "@/core/consts.js";

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

export function getAppConfigPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_SUBDIR, ".app.jsonc");
}

export function getBase44ApiUrl(): string {
  return process.env.BASE44_API_URL || "https://app.base44.com";
}
