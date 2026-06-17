import { globby } from "globby";
import { getAppConfigPath, getTestOverrides } from "@/core/config.js";
import { APP_CONFIG_PATTERN, BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  InvalidInputError,
  SchemaValidationError,
} from "@/core/errors.js";
import { findProjectRoot } from "@/core/project/find-root.js";
import type { AppConfig } from "@/core/project/schema.js";
import { AppConfigSchema } from "@/core/project/schema.js";
import { readJsonFile, writeFile } from "@/core/utils/fs.js";

export interface AppContext {
  id: string;
  projectRoot?: string;
}

interface InitAppContextOptions {
  appId?: string;
}

let cache: AppContext | null = null;

function loadFromTestOverrides(): AppContext | null {
  const appConfig = getTestOverrides()?.appConfig;
  if (appConfig?.id && appConfig.projectRoot) {
    return {
      id: appConfig.id,
      projectRoot: appConfig.projectRoot,
    };
  }
  return null;
}

/**
 * Initialize app context from a provided app id or .app.jsonc.
 * Returns the cached context, reading from disk only on first call.
 * @returns The app context with id and projectRoot when available
 * @throws Error if no app ID source is available
 */
export async function initAppContext(
  options: InitAppContextOptions = {},
): Promise<AppContext> {
  // Check for test overrides first
  const testConfig = loadFromTestOverrides();
  if (testConfig) {
    cache = testConfig;
    return cache;
  }

  const projectRoot = findProjectRoot();

  if (options.appId !== undefined) {
    const id = options.appId.trim();
    if (!id) {
      throw new InvalidInputError("App id cannot be empty.");
    }

    cache = { id };
    return cache;
  }

  if (cache) {
    return cache;
  }

  if (!projectRoot) {
    throw new ConfigNotFoundError(
      `No Base44 app ID found. Pass --app-id, set ${BASE44_APP_ID_ENV_VAR}, or run this command from a linked project with base44/.app.jsonc.`,
      {
        hints: [
          { message: "Pass an app ID explicitly with --app-id <id>" },
          { message: `Set ${BASE44_APP_ID_ENV_VAR} in your environment` },
          {
            message:
              "Run from a linked Base44 project with base44/.app.jsonc, or run 'base44 link'",
            command: "base44 link",
          },
        ],
      },
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

  cache = { projectRoot: projectRoot.root, id: config.id };
  return cache;
}

/**
 * Get the cached app context.
 * @throws ConfigInvalidError if not initialized - call initAppContext() or setAppContext() first
 */
export function getAppContext(): AppContext {
  if (!cache) {
    throw new ConfigInvalidError(
      "App context not initialized. Ensure the command uses requireAppContext option.",
    );
  }
  return cache;
}

export function setAppContext(context: AppContext): void {
  cache = context;
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

async function readAppConfig(projectRoot: string): Promise<AppConfig | null> {
  const configPath = await findAppConfigPath(projectRoot);

  if (!configPath) {
    return null;
  }

  const parsed = await readJsonFile(configPath);
  const result = AppConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid app configuration",
      result.error,
      configPath,
    );
  }

  return result.data;
}
