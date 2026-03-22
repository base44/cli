import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";

const ASSETS_DIR = join(homedir(), ".base44", "assets", packageJson.version);

export function getTemplatesDir(): string {
  return join(ASSETS_DIR, "templates");
}

export function getTemplatesIndexPath(): string {
  return join(ASSETS_DIR, "templates", "templates.json");
}

export function getDenoWrapperPath(): string {
  return join(ASSETS_DIR, "deno-runtime", "main.ts");
}

export function getExecWrapperPath(): string {
  return join(ASSETS_DIR, "deno-runtime", "exec.ts");
}

/**
 * For the npm distribution: copy bundled assets to the standard location
 * on first run. Binary entry handles its own extraction separately.
 */
export function ensureNpmAssets(sourceDir: string): void {
  if (existsSync(ASSETS_DIR)) return;
  if (!existsSync(sourceDir)) return;
  cpSync(sourceDir, ASSETS_DIR, { recursive: true });
}
