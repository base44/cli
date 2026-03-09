import type { KyResponse } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/index.js";
import { deleteSecret, setSecrets } from "@/core/resources/secret/index.js";
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
 * Single source of truth for the mapping between camelCase credential keys
 * (used in SSOCredentials types) and snake_case secret keys (used by the API).
 */
export const CREDENTIALS_KEY_MAP: Record<string, string> = {
  ssoName: "sso_name",
  ssoClientId: "sso_client_id",
  ssoClientSecret: "sso_client_secret",
  ssoScope: "sso_scope",
  ssoDiscoveryUrl: "sso_discovery_url",
  ssoTenantId: "sso_tenant_id",
  ssoAuthEndpoint: "sso_auth_endpoint",
  ssoTokenEndpoint: "sso_token_endpoint",
  ssoUserinfoEndpoint: "sso_userinfo_endpoint",
  ssoOktaDomain: "sso_okta_domain",
  ssoJwksUri: "sso_jwks_uri",
};

/** All possible SSO secret keys, derived from CREDENTIALS_KEY_MAP. */
const SSO_SECRET_KEYS = Object.values(CREDENTIALS_KEY_MAP);

/**
 * Removes SSO configuration: disables SSO in auth config and deletes all SSO secrets.
 */
export async function removeSSOConfig(): Promise<AuthConfig> {
  const updated = await updateAuthConfig({
    enableSSOLogin: false,
    ssoProviderName: null,
  });

  // Best-effort cleanup of all SSO secrets
  await Promise.allSettled(SSO_SECRET_KEYS.map((key) => deleteSecret(key)));

  return updated;
}

/**
 * Sets SSO secrets and updates auth config atomically.
 * If the auth config update fails, rolls back the secrets that were set.
 */
export async function submitSSOConfig(
  secrets: Record<string, string>,
  authConfigUpdates: Partial<AuthConfig>,
): Promise<AuthConfig> {
  await setSecrets(secrets);

  try {
    return await updateAuthConfig(authConfigUpdates);
  } catch (error) {
    // Best-effort rollback — don't mask the original error
    const secretKeys = Object.keys(secrets);
    await Promise.allSettled(secretKeys.map((key) => deleteSecret(key)));
    throw error;
  }
}
