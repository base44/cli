import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";

const ASSETS_ROOT = join(homedir(), ".base44", "assets");
const ASSETS_DIR = join(ASSETS_ROOT, packageJson.version);

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
  pruneOldAssetVersions();
}

/**
 * Remove asset directories left behind by previous CLI versions so
 * ~/.base44/assets doesn't grow with every release. Best effort: a failure
 * (e.g. another CLI version running concurrently on Windows holding a file
 * open) is ignored and retried on the next version's first run.
 */
function pruneOldAssetVersions(): void {
  try {
    for (const entry of readdirSync(ASSETS_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== packageJson.version) {
        rmSync(join(ASSETS_ROOT, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
  } catch {
    // Ignore: pruning must never break the CLI.
  }
}
