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

function getBackendRuntimeDir(): string {
  return join(ASSETS_DIR, "backend-runtime");
}

export function getDenoWrapperPath(): string {
  return join(getBackendRuntimeDir(), "main.ts");
}

export function getExecWrapperPath(): string {
  return join(getBackendRuntimeDir(), "exec.ts");
}

/**
 * For the npm distribution: copy bundled assets to the standard location
 * on first run. Binary entry handles its own extraction separately.
 */
export function ensureNpmAssets(sourceDir: string): void {
  // The version directory existing is not proof its contents are current. An
  // install that predates a renamed or added asset directory leaves the old
  // layout in place, so re-copy whenever an expected directory is missing
  // rather than only when the version directory is.
  if (existsSync(ASSETS_DIR) && existsSync(getBackendRuntimeDir())) return;
  if (!existsSync(sourceDir)) return;
  cpSync(sourceDir, ASSETS_DIR, { recursive: true });
}
