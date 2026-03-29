import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SchemaValidationError } from "@/core/errors.js";
import { CONFIG_FILE_EXTENSION } from "../../consts.js";
import { pathExists, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import type { AuthConfig } from "./schema.js";
import { AuthConfigFileSchema } from "./schema.js";

const AUTH_CONFIG_FILENAME = `config.${CONFIG_FILE_EXTENSION}`;

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enableUsernamePassword: false,
  enableGoogleLogin: false,
  enableMicrosoftLogin: false,
  enableFacebookLogin: false,
  enableAppleLogin: false,
  ssoProviderName: null,
  enableSSOLogin: false,
  googleOAuthMode: "default",
  googleOAuthClientId: null,
  useWorkspaceSSO: false,
};

function getAuthConfigPath(authDir: string): string {
  return join(authDir, AUTH_CONFIG_FILENAME);
}

/**
 * Reads the auth config file from the given directory.
 * Returns the config if the file exists, or null if the directory or file doesn't exist.
 */
export async function readAuthConfig(
  authDir: string,
): Promise<AuthConfig | null> {
  const filePath = getAuthConfigPath(authDir);

  if (!(await pathExists(filePath))) {
    return null;
  }

  const parsed = await readJsonFile(filePath);
  const result = AuthConfigFileSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid auth config file",
      result.error,
      filePath,
    );
  }

  return result.data;
}

/**
 * Writes the auth config to a file. Skips if the file content is unchanged.
 */
export async function writeAuthConfig(
  authDir: string,
  config: AuthConfig,
): Promise<{ written: boolean }> {
  const filePath = getAuthConfigPath(authDir);

  if (await pathExists(filePath)) {
    const existing = await readJsonFile(filePath);
    const existingResult = AuthConfigFileSchema.safeParse(existing);
    if (
      existingResult.success &&
      isDeepStrictEqual(existingResult.data, config)
    ) {
      return { written: false };
    }
  }

  await writeJsonFile(filePath, config);
  return { written: true };
}
