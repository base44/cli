import { dirname } from "node:path";
import { globbySync } from "globby";
import { PROJECT_CONFIG_PATTERNS } from "@/core/consts.js";
import type { ProjectRoot } from "@/core/project/types.js";

export function findConfigInDir(dir: string): string | null {
  const files = globbySync(PROJECT_CONFIG_PATTERNS, {
    cwd: dir,
    absolute: true,
  });
  return files[0] ?? null;
}

// Synchronous and dependency-light (no resource/client imports) so it can run at
// bootstrap before the HTTP clients capture the API URL. Walks up from
// `startPath` to the nearest directory holding a project config file.
export function findProjectRoot(
  startPath: string = process.cwd(),
): ProjectRoot | null {
  let current = startPath;
  while (current !== dirname(current)) {
    const configPath = findConfigInDir(current);
    if (configPath) {
      return { root: current, configPath };
    }
    current = dirname(current);
  }
  return null;
}
