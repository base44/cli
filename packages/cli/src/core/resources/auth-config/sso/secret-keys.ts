/**
 * All SSO secret keys expected by the backend API.
 * Used as the single source of truth for secret key names across
 * provider schemas, secret building, and cleanup.
 */
export enum SSOSecretKey {
  Name = "sso_name",
  ClientId = "sso_client_id",
  ClientSecret = "sso_client_secret",
  Scope = "sso_scope",
  DiscoveryUrl = "sso_discovery_url",
  TenantId = "sso_tenant_id",
  AuthEndpoint = "sso_auth_endpoint",
  TokenEndpoint = "sso_token_endpoint",
  UserinfoEndpoint = "sso_userinfo_endpoint",
  OktaDomain = "sso_okta_domain",
  JwksUri = "sso_jwks_uri",
}

/** All SSO secret key values, for bulk operations like cleanup. */
export const ALL_SSO_SECRET_KEYS: string[] = Object.values(SSOSecretKey);

/** Default OAuth scopes per provider category. */
export const DEFAULT_OIDC_SCOPE = "openid email profile";
export const DEFAULT_GITHUB_SCOPE = "user:email";
