import { setSecrets } from "@/core/resources/secret/index.js";
import {
  DEFAULT_AUTH_CONFIG,
  readAuthConfig,
  writeAuthConfig,
} from "./config.js";
import type { AuthConfig, ProviderName } from "./schema.js";
import { SOCIAL_PROVIDERS } from "./schema.js";

interface UpdateSocialLoginResult {
  /** The updated auth config after the change */
  config: AuthConfig;
  /** Whether the provider was enabled or disabled */
  enabled: boolean;
}

/**
 * Updates the local auth config to enable/disable a social login provider.
 * If the provider supports custom OAuth, sets or resets the OAuth fields accordingly.
 */
export async function updateSocialLoginConfig(
  authDir: string,
  provider: ProviderName,
  enable: boolean,
  customOAuth?: { clientId: string },
): Promise<UpdateSocialLoginResult> {
  const providerInfo = SOCIAL_PROVIDERS[provider];
  const current = (await readAuthConfig(authDir)) ?? DEFAULT_AUTH_CONFIG;

  const merged: AuthConfig = {
    ...current,
    [providerInfo.field]: enable,
  };

  if (providerInfo.customOAuth) {
    const oauth = providerInfo.customOAuth;
    if (enable && customOAuth) {
      merged[oauth.modeField] = "custom";
      merged[oauth.clientIdField] = customOAuth.clientId;
    } else {
      merged[oauth.modeField] = "default";
      merged[oauth.clientIdField] = null;
    }
  }

  await writeAuthConfig(authDir, merged);
  return { config: merged, enabled: enable };
}

/**
 * Pushes a custom OAuth client secret to the backend via the secrets API.
 */
export async function pushCustomOAuthSecret(
  provider: ProviderName,
  clientSecret: string,
): Promise<void> {
  const providerInfo = SOCIAL_PROVIDERS[provider];
  if (!providerInfo.customOAuth) {
    return;
  }
  await setSecrets({
    [providerInfo.customOAuth.secretKey]: clientSecret,
  });
}
