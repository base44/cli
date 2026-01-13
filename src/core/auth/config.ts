import { getAuthFilePath } from "../config.js";
import { readJsonFile, writeJsonFile, deleteFile } from "../utils/fs.js";
import { renewAccessToken } from "./api.js";
import { AuthDataSchema } from "./schema.js";
import type { AuthData } from "./schema.js";

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
      throw new Error(
        `Invalid authentication data: ${result.error.issues
          .map((e) => e.message)
          .join(", ")}`
      );
    }

    return result.data;
  } catch (error) {
    throw new Error(
      `Failed to read authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function writeAuth(authData: AuthData): Promise<void> {
  const result = AuthDataSchema.safeParse(authData);

  if (!result.success) {
    throw new Error(
      `Invalid authentication data: ${result.error.issues
        .map((e) => e.message)
        .join(", ")}`
    );
  }

  try {
    await writeJsonFile(getAuthFilePath(), result.data);
  } catch (error) {
    throw new Error(
      `Failed to write authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function deleteAuth(): Promise<void> {
  try {
    await deleteFile(getAuthFilePath());
  } catch (error) {
    throw new Error(
      `Failed to delete authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
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
