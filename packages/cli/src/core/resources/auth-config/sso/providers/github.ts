import { DEFAULT_GITHUB_SCOPE, SSOSecretKey } from "../secret-keys.js";
import type { SSOProviderSchema } from "../types.js";

export const githubProvider: SSOProviderSchema = {
  requiredKeys: [],
  defaults: {
    [SSOSecretKey.Scope]: DEFAULT_GITHUB_SCOPE,
    [SSOSecretKey.AuthEndpoint]: "https://github.com/login/oauth/authorize",
    [SSOSecretKey.TokenEndpoint]: "https://github.com/login/oauth/access_token",
    [SSOSecretKey.UserinfoEndpoint]: "https://api.github.com/user",
  },
};
