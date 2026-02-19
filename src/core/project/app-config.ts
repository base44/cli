import { globby } from "globby";
import { getAppConfigPath, getTestOverrides } from "@/core/config.js";
import { APP_CONFIG_PATTERN } from "@/core/consts.js";
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  SchemaValidationError,
} from "@/core/errors.js";
import { findProjectRoot } from "@/core/project/config.js";
import type { AppConfigFile } from "@/core/project/schema.js";
import { AppConfigFileSchema } from "@/core/project/schema.js";
import { readJsonFile, writeFile } from "@/core/utils/fs.js";

export type AppConfig = { id: string; projectRoot: string };

// Not concurrent-safe; fine for a sequential CLI.
let _current: AppConfig | null = null;

/**
 * Execute a function with app config in scope.
 * Any code that calls getAppConfig() inside `fn` will get this config.
 * Automatically cleans up when fn completes (or throws).
 */
export async function withAppConfig<T>(
  config: AppConfig,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = _current;
  _current = config;
  try {
    return await fn();
  } finally {
    _current = prev;
  }
}

/**
 * Read app config from disk (or test overrides). Pure function, no caching.
 * Use withAppConfig() to make the result available to getAppConfig().
 */
export async function resolveAppConfig(): Promise<AppConfig> {
  const testOverride = getTestOverrides()?.appConfig;
  if (testOverride?.id && testOverride.projectRoot) {
    return { id: testOverride.id, projectRoot: testOverride.projectRoot };
  }

  const projectRoot = await findProjectRoot();
  if (!projectRoot) {
    throw new ConfigNotFoundError(
      "No Base44 project found. Run this command from a project directory with a config.jsonc file.",
    );
  }

  const config = await readAppConfig(projectRoot.root);
  const appConfigPath = await findAppConfigPath(projectRoot.root);

  if (!config?.id) {
    throw new ConfigInvalidError(
      "App not configured. Create a .app.jsonc file or run 'base44 link' to link this project.",
      appConfigPath,
      {
        hints: [
          {
            message: "Run 'base44 link' to link this project to a Base44 app",
            command: "base44 link",
          },
        ],
      },
    );
  }

  return { projectRoot: projectRoot.root, id: config.id };
}

/**
 * Get the current app config. Must be called inside withAppConfig().
 */
export function getAppConfig(): AppConfig {
  if (!_current) {
    throw new ConfigInvalidError(
      "App config not initialized. Ensure the command uses requireAppConfig option.",
    );
  }
  return _current;
}

function generateAppConfigContent(id: string): string {
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
  appId: string,
): Promise<string> {
  const configPath = getAppConfigPath(projectRoot);
  const content = generateAppConfigContent(appId);
  await writeFile(configPath, content);
  return configPath;
}

async function findAppConfigPath(projectRoot: string): Promise<string | null> {
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
  projectRoot: string,
): Promise<AppConfigFile | null> {
  const configPath = await findAppConfigPath(projectRoot);

  if (!configPath) {
    return null;
  }

  const parsed = await readJsonFile(configPath);
  const result = AppConfigFileSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid app configuration",
      result.error,
      configPath,
    );
  }

  return result.data;
}
