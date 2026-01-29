import { globby } from "globby";
import { getAppConfigPath } from "@/core/config.js";
import { writeFile, readJsonFile } from "@/core/utils/fs.js";
import { APP_CONFIG_PATTERN } from "@/core/consts.js";
import { AppConfigSchema } from "@/core/project/schema.js";
import type { AppConfig } from "@/core/project/schema.js";
import { findProjectRoot } from "@/core/project/config.js";

export interface CachedAppConfig {
  id: string;
  projectRoot: string;
}

let cache: CachedAppConfig | null = null;

/**
 * Load app config from BASE44_CLI_TEST_OVERRIDES env var.
 * @returns true if override was applied, false otherwise
 */
function loadFromTestOverrides(): boolean {
  const overrides = process.env.BASE44_CLI_TEST_OVERRIDES;
  if (!overrides) {
    return false;
  }

  try {
    const data = JSON.parse(overrides);
    if (data.appConfig?.id && data.appConfig?.projectRoot) {
      cache = { id: data.appConfig.id, projectRoot: data.appConfig.projectRoot };
      return true;
    }
  } catch {
    // Invalid JSON, ignore
  }
  return false;
}

/**
 * Initialize app config by reading from .app.jsonc.
 * Returns the cached config, reading from disk only on first call.
 * @returns The app config with id and projectRoot
 * @throws Error if no project found or .app.jsonc missing
 */
export async function initAppConfig(): Promise<CachedAppConfig> {
  // Check for test overrides first
  if (loadFromTestOverrides()) {
    return cache!;
  }

  if (cache) {
    return cache;
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
  return cache;
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
  const files = await globby(APP_CONFIG_PATTERN, {
    cwd: projectRoot,
    absolute: true,
  });
  return files[0] ?? null;
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
