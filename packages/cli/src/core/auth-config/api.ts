import type { KyResponse } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/index.js";
import type { AuthConfig } from "./schema.js";
import { AppAuthConfigResponseSchema, toAuthConfigPayload } from "./schema.js";

/**
 * Fetches the current auth config for the app.
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  const { id } = getAppConfig();

  let response: KyResponse;
  try {
    response = await base44Client.get(`api/apps/${id}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching auth config");
  }

  const result = AppAuthConfigResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data.authConfig;
}

/**
 * Updates the auth config for the app.
 * Merges the partial update with the current config via a read-modify-write cycle.
 */
async function updateAuthConfig(
  updates: Partial<AuthConfig>,
): Promise<AuthConfig> {
  const current = await getAuthConfig();
  const merged: AuthConfig = { ...current, ...updates };

  const { id } = getAppConfig();

  let response: KyResponse;
  try {
    response = await base44Client.put(`api/apps/${id}`, {
      json: { auth_config: toAuthConfigPayload(merged) },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "updating auth config");
  }

  const result = AppAuthConfigResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data.authConfig;
}

/**
 * Returns true if at least one login method is enabled in the given config.
 */
export function hasAnyLoginMethod(config: AuthConfig): boolean {
  return (
    config.enableUsernamePassword ||
    config.enableGoogleLogin ||
    config.enableMicrosoftLogin ||
    config.enableFacebookLogin ||
    config.enableAppleLogin ||
    config.enableSSOLogin
  );
}

/**
 * Enables or disables username/password authentication.
 */
export async function updatePasswordAuth(enable: boolean): Promise<AuthConfig> {
  return await updateAuthConfig({ enableUsernamePassword: enable });
}
