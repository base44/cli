import { describe, expect, it } from "vitest";
import {
  AppAuthConfigResponseSchema,
  AuthConfigSchema,
  toAuthConfigPayload,
} from "../../src/core/auth-config/schema.js";

describe("AuthConfigSchema", () => {
  const validApiResponse = {
    enable_username_password: true,
    enable_google_login: true,
    enable_microsoft_login: false,
    enable_facebook_login: false,
    enable_apple_login: false,
    sso_provider_name: "google",
    enable_sso_login: true,
    google_oauth_mode: "default",
    google_oauth_client_id: null,
    use_workspace_sso: false,
  };

  it("transforms snake_case API response to camelCase", () => {
    const result = AuthConfigSchema.safeParse(validApiResponse);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual({
      enableUsernamePassword: true,
      enableGoogleLogin: true,
      enableMicrosoftLogin: false,
      enableFacebookLogin: false,
      enableAppleLogin: false,
      ssoProviderName: "google",
      enableSSOLogin: true,
      googleOAuthMode: "default",
      googleOAuthClientId: null,
      useWorkspaceSSO: false,
    });
  });

  it("accepts null sso_provider_name", () => {
    const response = { ...validApiResponse, sso_provider_name: null };
    const result = AuthConfigSchema.safeParse(response);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ssoProviderName).toBeNull();
  });

  it("accepts any string as sso_provider_name", () => {
    const response = {
      ...validApiResponse,
      sso_provider_name: "my-custom-idp",
    };
    const result = AuthConfigSchema.safeParse(response);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ssoProviderName).toBe("my-custom-idp");
  });

  it("rejects missing required fields", () => {
    const result = AuthConfigSchema.safeParse({
      enable_username_password: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("AppAuthConfigResponseSchema", () => {
  it("extracts and transforms auth_config from app response", () => {
    const appResponse = {
      auth_config: {
        enable_username_password: true,
        enable_google_login: false,
        enable_microsoft_login: false,
        enable_facebook_login: false,
        enable_apple_login: false,
        sso_provider_name: "okta",
        enable_sso_login: true,
        google_oauth_mode: "default",
        google_oauth_client_id: null,
        use_workspace_sso: true,
      },
    };

    const result = AppAuthConfigResponseSchema.safeParse(appResponse);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.authConfig.ssoProviderName).toBe("okta");
    expect(result.data.authConfig.enableSSOLogin).toBe(true);
    expect(result.data.authConfig.useWorkspaceSSO).toBe(true);
  });
});

describe("toAuthConfigPayload", () => {
  it("converts camelCase back to snake_case", () => {
    const config = {
      enableUsernamePassword: true,
      enableGoogleLogin: true,
      enableMicrosoftLogin: false,
      enableFacebookLogin: false,
      enableAppleLogin: false,
      ssoProviderName: "github",
      enableSSOLogin: true,
      googleOAuthMode: "default" as const,
      googleOAuthClientId: null,
      useWorkspaceSSO: false,
    };

    const payload = toAuthConfigPayload(config);

    expect(payload).toEqual({
      enable_username_password: true,
      enable_google_login: true,
      enable_microsoft_login: false,
      enable_facebook_login: false,
      enable_apple_login: false,
      sso_provider_name: "github",
      enable_sso_login: true,
      google_oauth_mode: "default",
      google_oauth_client_id: null,
      use_workspace_sso: false,
    });
  });
});
