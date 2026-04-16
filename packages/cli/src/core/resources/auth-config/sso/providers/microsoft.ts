import { DEFAULT_OIDC_SCOPE, SSOSecretKey } from "../secret-keys.js";
import type { SSOProviderSchema } from "../types.js";

export const microsoftProvider: SSOProviderSchema = {
  requiredKeys: [SSOSecretKey.TenantId],
  defaults: {
    [SSOSecretKey.Scope]: DEFAULT_OIDC_SCOPE,
  },
  deriveDefaults: (secrets): Record<string, string> => {
    const tenantId = secrets[SSOSecretKey.TenantId];
    if (tenantId) {
      return {
        [SSOSecretKey.DiscoveryUrl]: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
      };
    }
    return {};
  },
};
