import { dirname } from "node:path";
import { globby } from "globby";
import { getAppConfigPath } from "@core/config.js";
import { writeFile, readJsonFile } from "../utils/fs.js";
import { APP_CONFIG_PATTERN } from "../consts.js";
import { AppConfigSchema } from "./schema.js";
import type { AppConfig } from "./schema.js";
import { findProjectRoot } from "./config.js";

export interface CachedAppConfig {
  id: string;
  projectRoot: string;
}

let cache: CachedAppConfig | null = null;

/**
 * Initialize app config by reading from .app.jsonc.
 * Must be called before using getAppConfig().
 * @throws Error if no project found or .app.jsonc missing
 */
export async function initAppConfig(): Promise<void> {
  if (cache) {
    return;
  }

  const projectRoot = await findProjectRoot();
  if (!projectRoot) {
    throw new Error(
      "No Base44 project found. Run this command from a project directory with a config.jsonc file."
    );
  }

  const config = await readAppConfig(projectRoot.root);
  if (!config?.id) {
    throw new Error(
      "App not configured. Create a .app.jsonc file or run 'base44 link' to link this project."
    );
  }

  cache = { projectRoot: projectRoot.root, id: config.id };
}

/**
 * Clear the cache. Useful for testing.
 */
export function clearAppConfigCache(): void {
  cache = null;
}

/**
 * Get the cached app config.
 * @throws Error if not initialized - call initAppConfig() or setAppConfig() first
 */
export function getAppConfig(): CachedAppConfig {
  if (!cache) {
    throw new Error(
      "App config not initialized. Ensure the command uses requireAppConfig option."
    );
  }
  return cache;
}

export function setAppConfig(config: CachedAppConfig): void {
  cache = config;
}

export function generateAppConfigContent(id: string): string {
  return `// Base44 App Configuration
// This file links your local project to your Base44 app.
// Do not commit this file to version control.
{
  "id": "${id}"
}
`;
}

export async function writeAppConfig(
  projectRoot: string,
  appId: string
): Promise<string> {
  const configPath = getAppConfigPath(projectRoot);
  const content = generateAppConfigContent(appId);
  await writeFile(configPath, content);
  return configPath;
}

export async function findAppConfigPath(
  projectRoot: string
): Promise<string | null> {
  let current = projectRoot;
  const root = dirname(projectRoot);

  // First, try to find the .app.jsonc in the project root
  let files = await globby(APP_CONFIG_PATTERN, {
    cwd: current,
    absolute: true,
  });

  if (files.length > 0) {
    return files[0];
  }

  // If not found and we're in a base44 subdirectory, try the parent directory
  // This handles the case where config.jsonc is in base44/ but .app.jsonc is in parent/base44/
  while (current !== root && current !== dirname(current)) {
    current = dirname(current);
    files = await globby(APP_CONFIG_PATTERN, {
      cwd: current,
      absolute: true,
    });

    if (files.length > 0) {
      return files[0];
    }
  }

  return null;
}

export async function appConfigExists(projectRoot: string): Promise<boolean> {
  const configPath = await findAppConfigPath(projectRoot);
  return configPath !== null;
}

async function readAppConfig(
  projectRoot: string
): Promise<AppConfig | null> {
  const configPath = await findAppConfigPath(projectRoot);

  if (!configPath) {
    return null;
  }

  const parsed = await readJsonFile(configPath);
  const result = AppConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`Invalid app configuration: ${result.error.message}`);
  }

  return result.data;
}
