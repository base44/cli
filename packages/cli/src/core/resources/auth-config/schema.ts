import { z } from "zod";

const GoogleOAuthMode = z.enum(["default", "custom"]);

/**
 * Schema for the auth_config object returned by the API (snake_case).
 * Transforms to camelCase for internal use.
 */
export const AuthConfigSchema = z
  .object({
    enable_username_password: z.boolean(),
    enable_google_login: z.boolean(),
    enable_microsoft_login: z.boolean(),
    enable_facebook_login: z.boolean(),
    enable_apple_login: z.boolean(),
    sso_provider_name: z.string().nullable(),
    enable_sso_login: z.boolean(),
    google_oauth_mode: GoogleOAuthMode,
    google_oauth_client_id: z.string().nullable(),
    use_workspace_sso: z.boolean(),
  })
  .transform((data) => ({
    enableUsernamePassword: data.enable_username_password,
    enableGoogleLogin: data.enable_google_login,
    enableMicrosoftLogin: data.enable_microsoft_login,
    enableFacebookLogin: data.enable_facebook_login,
    enableAppleLogin: data.enable_apple_login,
    ssoProviderName: data.sso_provider_name,
    enableSSOLogin: data.enable_sso_login,
    googleOAuthMode: data.google_oauth_mode,
    googleOAuthClientId: data.google_oauth_client_id,
    useWorkspaceSSO: data.use_workspace_sso,
  }));

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

/**
 * Schema for validating local auth config files (camelCase, no transform).
 */
export const AuthConfigFileSchema = z.object({
  enableUsernamePassword: z.boolean(),
  enableGoogleLogin: z.boolean(),
  enableMicrosoftLogin: z.boolean(),
  enableFacebookLogin: z.boolean(),
  enableAppleLogin: z.boolean(),
  ssoProviderName: z.string().nullable(),
  enableSSOLogin: z.boolean(),
  googleOAuthMode: GoogleOAuthMode,
  googleOAuthClientId: z.string().nullable(),
  useWorkspaceSSO: z.boolean(),
});

/**
 * Schema for the app response — we only care about auth_config.
 */
export const AppAuthConfigResponseSchema = z
  .object({
    auth_config: AuthConfigSchema,
  })
  .transform((data) => ({
    authConfig: data.auth_config,
  }));

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
 * Converts camelCase AuthConfig back to snake_case for the API request body.
 */
export function toAuthConfigPayload(
  config: AuthConfig,
): Record<string, unknown> {
  return {
    enable_username_password: config.enableUsernamePassword,
    enable_google_login: config.enableGoogleLogin,
    enable_microsoft_login: config.enableMicrosoftLogin,
    enable_facebook_login: config.enableFacebookLogin,
    enable_apple_login: config.enableAppleLogin,
    sso_provider_name: config.ssoProviderName,
    enable_sso_login: config.enableSSOLogin,
    google_oauth_mode: config.googleOAuthMode,
    google_oauth_client_id: config.googleOAuthClientId,
    use_workspace_sso: config.useWorkspaceSSO,
  };
}
