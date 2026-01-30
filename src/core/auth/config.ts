import { getAuthFilePath } from "@/core/config.js";
import { readJsonFile, writeJsonFile, deleteFile } from "@/core/utils/fs.js";
import { renewAccessToken } from "@/core/auth/api.js";
import { AuthDataSchema } from "@/core/auth/schema.js";
import type { AuthData } from "@/core/auth/schema.js";
import {
  AuthRequiredError,
  SchemaValidationError,
  FileReadError,
} from "@/core/errors.js";

// Buffer time before expiration to trigger proactive refresh (60 seconds)
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

// Lock to prevent concurrent token refreshes
let refreshPromise: Promise<string | null> | null = null;

/**
 * Reads and validates the stored authentication data.
 *
 * @returns The parsed authentication data (tokens, user info).
 * @throws {Error} If not logged in or if auth data is corrupted.
 *
 * @example
 * const auth = await readAuth();
 * console.log(`Logged in as: ${auth.email}`);
 */
export async function readAuth(): Promise<AuthData> {
  try {
    const parsed = await readJsonFile(getAuthFilePath());
    const result = AuthDataSchema.safeParse(parsed);

    if (!result.success) {
      throw new SchemaValidationError("Invalid authentication data", result.error);
    }

    return result.data;
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw error;
    }
    throw new FileReadError(
      `Failed to read authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

export async function writeAuth(authData: AuthData): Promise<void> {
  const result = AuthDataSchema.safeParse(authData);

  if (!result.success) {
    throw new SchemaValidationError("Invalid authentication data", result.error);
  }

  try {
    await writeJsonFile(getAuthFilePath(), result.data);
  } catch (error) {
    throw new FileReadError(
      `Failed to write authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

export async function deleteAuth(): Promise<void> {
  try {
    await deleteFile(getAuthFilePath());
  } catch (error) {
    throw new FileReadError(
      `Failed to delete authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

export function isTokenExpired(auth: AuthData): boolean {
  return Date.now() >= auth.expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

export async function refreshAndSaveTokens(): Promise<string | null> {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const auth = await readAuth();
      const tokenResponse = await renewAccessToken(auth.refreshToken);

      await writeAuth({
        ...auth,
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        expiresAt: Date.now() + tokenResponse.expiresIn * 1000,
      });

      return tokenResponse.accessToken;
    } catch {
      // Refresh failed - delete auth, user needs to login again
      await deleteAuth();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Checks if the user is currently logged in.
 *
 * @returns True if authentication data exists and is valid, false otherwise.
 *
 * @example
 * if (await isLoggedIn()) {
 *   console.log("User is logged in");
 * } else {
 *   console.log("Please login first");
 * }
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    await readAuth();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures the user is logged in before proceeding.
 *
 * @throws {AuthRequiredError} If the user is not logged in.
 *
 * @example
 * await requireAuth();
 * // Code here will only run if user is authenticated
 */
export async function requireAuth(): Promise<void> {
  if (!(await isLoggedIn())) {
    throw new AuthRequiredError("Not logged in. Please run 'base44 login' first.");
  }
}
