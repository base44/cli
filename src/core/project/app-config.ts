import { join } from "node:path";
import { globby } from "globby";
import { writeFile, pathExists, readJsonFile } from "../utils/fs.js";
import { PROJECT_SUBDIR, getAppConfigPatterns } from "../consts.js";
import { AppConfigSchema } from "./schema.js";
import type { AppConfig } from "./schema.js";

const APP_CONFIG_TEMPLATE = `// Base44 App Configuration
// This file links your local project to your Base44 app.
// Do not commit this file to version control.
{
  "appId": "{{appId}}"
}
`;

export function generateAppConfigContent(appId: string): string {
  return APP_CONFIG_TEMPLATE.replace("{{appId}}", appId);
}

export function getAppConfigPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_SUBDIR, ".app.jsonc");
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

/**
 * Find the app config file (.app.jsonc or .app.json) in the project root.
 */
export async function findAppConfigPath(
  projectRoot: string
): Promise<string | null> {
  const files = await globby(getAppConfigPatterns(), {
    cwd: projectRoot,
    absolute: true,
  });
  return files[0] ?? null;
}

export async function appConfigExists(projectRoot: string): Promise<boolean> {
  const configPath = await findAppConfigPath(projectRoot);
  return configPath !== null && (await pathExists(configPath));
}

/**
 * Read and validate the app config from the project root.
 * Returns null if the config file doesn't exist.
 */
export async function readAppConfig(
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

/**
 * Get the appId from the project's .app.jsonc file.
 * Returns undefined if the config file doesn't exist.
 */
export async function getAppId(projectRoot: string): Promise<string | undefined> {
  const config = await readAppConfig(projectRoot);
  return config?.appId;
}
