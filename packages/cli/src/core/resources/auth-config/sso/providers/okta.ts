import { DEFAULT_OIDC_SCOPE, SSOSecretKey } from "../secret-keys.js";
import type { SSOProviderSchema } from "../types.js";

export const oktaProvider: SSOProviderSchema = {
  requiredKeys: [SSOSecretKey.OktaDomain],
  defaults: {
    [SSOSecretKey.Scope]: DEFAULT_OIDC_SCOPE,
  },
  deriveDefaults: (secrets): Record<string, string> => {
    const domain = secrets[SSOSecretKey.OktaDomain];
    if (domain) {
      return {
        [SSOSecretKey.DiscoveryUrl]: `https://${domain}/.well-known/openid-configuration`,
      };
    }
    return {};
  },
};
