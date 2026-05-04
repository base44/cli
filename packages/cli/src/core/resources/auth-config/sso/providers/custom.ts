import { DEFAULT_OIDC_SCOPE, SSOSecretKey } from "../secret-keys.js";
import type { SSOProviderSchema } from "../types.js";

export const customProvider: SSOProviderSchema = {
  requiredKeys: [
    SSOSecretKey.AuthEndpoint,
    SSOSecretKey.TokenEndpoint,
    SSOSecretKey.UserinfoEndpoint,
    SSOSecretKey.JwksUri,
  ],
  defaults: {
    [SSOSecretKey.Scope]: DEFAULT_OIDC_SCOPE,
  },
};
