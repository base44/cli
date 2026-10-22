import { mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { renewAccessToken } from "@/core/auth/api.js";
import type { AuthData } from "@/core/auth/schema.js";
import { AuthDataSchema } from "@/core/auth/schema.js";
import { getAuthFilePath } from "@/core/config.js";
import {
  ApiError,
  FileReadError,
  SchemaValidationError,
} from "@/core/errors.js";
import { deleteFile, readJsonFile, writeJsonFile } from "@/core/utils/fs.js";

// Buffer time before expiration to trigger proactive refresh (60 seconds)
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const WORKSPACE_API_KEY_PREFIX = "b44k_";

// A lock older than this belongs to a process that died mid-refresh
const REFRESH_LOCK_STALE_MS = 30 * 1000;
const REFRESH_LOCK_RETRY_MS = 50;

// Lock to prevent concurrent token refreshes within this process
let refreshPromise: Promise<string | null> | null = null;

export function getWorkspaceApiKeyFromEnv(): string | null {
  const key = process.env.BASE44_API_KEY?.trim();
  return key ? key : null;
}

export function isWorkspaceApiKey(value: string): boolean {
  return value.startsWith(WORKSPACE_API_KEY_PREFIX);
}

export function hasWorkspaceApiKeyAuth(): boolean {
  const key = getWorkspaceApiKeyFromEnv();
  return key !== null && isWorkspaceApiKey(key);
}

export async function seedAuthFromEnv(): Promise<void> {
  const accessToken = process.env.BASE44_ACCESS_TOKEN;
  if (!accessToken) {
    return;
  }

  const refreshToken = process.env.BASE44_REFRESH_TOKEN;
  // Decode without verifying the signature — the server still validates it.
  const claims = jwt.decode(accessToken);
  const payload: JwtPayload | null =
    claims !== null && typeof claims === "object" ? claims : null;
  const sub = typeof payload?.sub === "string" ? payload.sub : undefined;
  const exp = typeof payload?.exp === "number" ? payload.exp : undefined;

  if (!refreshToken || !sub || !exp) {
    return;
  }

  await writeAuth({
    accessToken,
    refreshToken,
    expiresAt: exp * 1000, // exp is in seconds; expiresAt is milliseconds.
    email: sub,
    name: sub, // No name claim; use the identity.
  });
}

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
    const authData = await readJsonFile(getAuthFilePath());
    const result = AuthDataSchema.safeParse(authData);

    if (!result.success) {
      throw new SchemaValidationError(
        "Invalid authentication data",
        result.error,
        getAuthFilePath(),
      );
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
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export async function writeAuth(authData: AuthData): Promise<void> {
  const result = AuthDataSchema.safeParse(authData);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid authentication data",
      result.error,
      getAuthFilePath(),
    );
  }

  try {
    await writeJsonFile(getAuthFilePath(), result.data);
  } catch (error) {
    throw new FileReadError(
      `Failed to write authentication file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { cause: error instanceof Error ? error : undefined },
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
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function isTokenExpired(auth: AuthData): boolean {
  return Date.now() >= auth.expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

// Refresh tokens rotate on use, so parallel CLI processes must not refresh
// with the same one: the losers would be rejected and log the user out.
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = `${getAuthFilePath()}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      await (await open(lockPath, "wx")).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const lock = await stat(lockPath).catch(() => null);
      if (lock && Date.now() - lock.mtimeMs > REFRESH_LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => {});
      } else {
        await sleep(REFRESH_LOCK_RETRY_MS);
      }
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

export async function refreshAndSaveTokens(): Promise<string | null> {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const staleRefreshToken = (await readAuth()).refreshToken;
      return await withRefreshLock(async () => {
        const auth = await readAuth();
        if (auth.refreshToken !== staleRefreshToken) {
          // Another process refreshed while we waited for the lock
          return auth.accessToken;
        }

        const tokenResponse = await renewAccessToken(auth.refreshToken);
        await writeAuth({
          ...auth,
          accessToken: tokenResponse.accessToken,
          refreshToken: tokenResponse.refreshToken,
          expiresAt: Date.now() + tokenResponse.expiresIn * 1000,
        });
        return tokenResponse.accessToken;
      });
    } catch (error) {
      // Only a rejected refresh token means the user must log in again;
      // keep auth on network or server errors.
      if (
        error instanceof ApiError &&
        (error.statusCode === 400 || error.statusCode === 401)
      ) {
        await deleteAuth();
      }
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
