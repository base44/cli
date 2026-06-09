import { renewAccessToken } from "@/core/auth/api.js";
import type { AuthData } from "@/core/auth/schema.js";
import { AuthDataSchema } from "@/core/auth/schema.js";
import { getAuthFilePath } from "@/core/config.js";
import { FileReadError, SchemaValidationError } from "@/core/errors.js";
import { deleteFile, readJsonFile, writeJsonFile } from "@/core/utils/fs.js";

// Buffer time before expiration to trigger proactive refresh (60 seconds)
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

// Lock to prevent concurrent token refreshes
let refreshPromise: Promise<string | null> | null = null;

/**
 * Decodes a JWT payload's claims WITHOUT verifying the signature (display/expiry
 * use only — the server still validates the token). Returns null for non-JWTs.
 */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Seeds the standard auth file from env-supplied credentials — for
 * non-interactive flows (CI, agents, provisioning tools) that inject the app's
 * bearer token via the environment. Decodes the `BASE44_ACCESS_TOKEN` JWT
 * (`sub` → email, `exp` → expiry), reads `BASE44_REFRESH_TOKEN`, and writes a
 * standard auth record so the rest of the CLI uses one file-based path. Called
 * from `ensureAuth`.
 *
 * Overwrites an existing login when env vars are present; no-ops when they can't
 * form a standard record (not a JWT with `exp`, or no refresh token).
 *
 * @returns true if an auth file was written.
 */
export async function seedAuthFromEnv(): Promise<boolean> {
  const accessToken = process.env.BASE44_ACCESS_TOKEN;
  if (!accessToken) {
    return false;
  }

  const refreshToken = process.env.BASE44_REFRESH_TOKEN;
  const claims = decodeJwtClaims(accessToken);
  const sub = typeof claims?.sub === "string" ? claims.sub : undefined;
  const exp = typeof claims?.exp === "number" ? claims.exp : undefined;

  // A standard auth record needs all fields; bail if the env creds can't form one.
  if (!refreshToken || !sub || !exp) {
    return false;
  }

  await writeAuth({
    accessToken,
    refreshToken,
    expiresAt: exp * 1000, // `exp` is in seconds; expiresAt is in milliseconds.
    email: sub,
    name: sub, // No name claim in the token; use the identity.
  });
  return true;
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
