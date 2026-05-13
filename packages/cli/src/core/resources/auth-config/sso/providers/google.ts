import { DEFAULT_OIDC_SCOPE, SSOSecretKey } from "../secret-keys.js";
import type { SSOProviderSchema } from "../types.js";

export const googleProvider: SSOProviderSchema = {
  requiredKeys: [],
  defaults: {
    [SSOSecretKey.Scope]: DEFAULT_OIDC_SCOPE,
    [SSOSecretKey.DiscoveryUrl]:
      "https://accounts.google.com/.well-known/openid-configuration",
  },
};
