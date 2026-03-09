import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "../../src/core/auth-config/schema.js";

// Mock project config
vi.mock("../../src/core/project/index.js", () => ({
  getAppConfig: () => ({ id: "test-app-id" }),
  initAppConfig: () => ({ id: "test-app-id" }),
}));

// Mock HTTP client
const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock("../../src/core/clients/index.js", () => ({
  base44Client: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}));

// Mock secrets
const mockSetSecrets = vi.fn();
const mockDeleteSecret = vi.fn();
vi.mock("../../src/core/resources/secret/index.js", () => ({
  setSecrets: (...args: unknown[]) => mockSetSecrets(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
}));

import {
  removeSSOConfig,
  submitSSOConfig,
} from "../../src/core/auth-config/api.js";

const DEFAULT_AUTH_CONFIG = {
  enable_username_password: true,
  enable_google_login: false,
  enable_microsoft_login: false,
  enable_facebook_login: false,
  enable_apple_login: false,
  sso_provider_name: null,
  enable_sso_login: false,
  google_oauth_mode: "default",
  google_oauth_client_id: null,
  use_workspace_sso: false,
};

function mockAppResponse(overrides: Record<string, unknown> = {}) {
  return {
    json: () =>
      Promise.resolve({
        auth_config: { ...DEFAULT_AUTH_CONFIG, ...overrides },
      }),
  };
}

describe("submitSSOConfig", () => {
  const secrets = {
    sso_name: "google",
    sso_client_id: "client-id",
    sso_client_secret: "client-secret",
    sso_scope: "openid email profile",
    sso_discovery_url:
      "https://accounts.google.com/.well-known/openid-configuration",
  };

  const authConfigUpdates: Partial<AuthConfig> = {
    ssoProviderName: "google",
    enableSSOLogin: true,
    useWorkspaceSSO: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSetSecrets.mockResolvedValue({ success: true });
    mockDeleteSecret.mockResolvedValue({ success: true });
  });

  it("sets secrets and updates auth config on success", async () => {
    // GET for updateAuthConfig's internal getAuthConfig call
    mockGet.mockResolvedValue(mockAppResponse());
    // PUT for updateAuthConfig
    mockPut.mockResolvedValue(
      mockAppResponse({
        sso_provider_name: "google",
        enable_sso_login: true,
      }),
    );

    const result = await submitSSOConfig(secrets, authConfigUpdates);

    expect(mockSetSecrets).toHaveBeenCalledWith(secrets);
    expect(mockPut).toHaveBeenCalledOnce();
    expect(result.ssoProviderName).toBe("google");
    expect(result.enableSSOLogin).toBe(true);
    // No rollback should have happened
    expect(mockDeleteSecret).not.toHaveBeenCalled();
  });

  it("rolls back secrets when auth config update fails", async () => {
    // GET for updateAuthConfig's internal getAuthConfig call
    mockGet.mockResolvedValue(mockAppResponse());
    // PUT fails
    mockPut.mockRejectedValue(new Error("Server error"));

    await expect(submitSSOConfig(secrets, authConfigUpdates)).rejects.toThrow();

    // Secrets were set first
    expect(mockSetSecrets).toHaveBeenCalledWith(secrets);
    // All secret keys were deleted as rollback
    expect(mockDeleteSecret).toHaveBeenCalledTimes(Object.keys(secrets).length);
    for (const key of Object.keys(secrets)) {
      expect(mockDeleteSecret).toHaveBeenCalledWith(key);
    }
  });

  it("does not roll back secrets when setSecrets itself fails", async () => {
    mockSetSecrets.mockRejectedValue(new Error("Secrets API error"));

    await expect(submitSSOConfig(secrets, authConfigUpdates)).rejects.toThrow(
      "Secrets API error",
    );

    // No auth config update or rollback should have happened
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockDeleteSecret).not.toHaveBeenCalled();
  });

  it("still throws original error if rollback also fails", async () => {
    mockGet.mockResolvedValue(mockAppResponse());
    mockPut.mockRejectedValue(new Error("Auth config failed"));
    mockDeleteSecret.mockRejectedValue(new Error("Delete failed"));

    await expect(submitSSOConfig(secrets, authConfigUpdates)).rejects.toThrow(
      "Auth config failed",
    );

    // Rollback was attempted
    expect(mockDeleteSecret).toHaveBeenCalled();
  });
});

describe("removeSSOConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDeleteSecret.mockResolvedValue({ success: true });
  });

  it("disables SSO and deletes all SSO secrets", async () => {
    // GET for updateAuthConfig's internal getAuthConfig
    mockGet.mockResolvedValue(
      mockAppResponse({
        sso_provider_name: "google",
        enable_sso_login: true,
      }),
    );
    // PUT to disable SSO
    mockPut.mockResolvedValue(
      mockAppResponse({
        sso_provider_name: null,
        enable_sso_login: false,
      }),
    );

    const result = await removeSSOConfig();

    expect(result.enableSSOLogin).toBe(false);
    expect(result.ssoProviderName).toBeNull();
    // Should attempt to delete all possible SSO secret keys
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_name");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_client_id");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_client_secret");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_scope");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_discovery_url");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_tenant_id");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_auth_endpoint");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_token_endpoint");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_userinfo_endpoint");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_okta_domain");
    expect(mockDeleteSecret).toHaveBeenCalledWith("sso_jwks_uri");
  });

  it("still succeeds if some secret deletions fail", async () => {
    mockGet.mockResolvedValue(
      mockAppResponse({
        sso_provider_name: "google",
        enable_sso_login: true,
      }),
    );
    mockPut.mockResolvedValue(
      mockAppResponse({
        sso_provider_name: null,
        enable_sso_login: false,
      }),
    );
    // Some secrets don't exist — delete fails for them
    mockDeleteSecret.mockRejectedValue(new Error("Not found"));

    const result = await removeSSOConfig();

    // Should still succeed — secret deletion is best-effort
    expect(result.enableSSOLogin).toBe(false);
    expect(result.ssoProviderName).toBeNull();
  });

  it("throws if auth config update fails", async () => {
    mockGet.mockResolvedValue(mockAppResponse());
    mockPut.mockRejectedValue(new Error("Server error"));

    await expect(removeSSOConfig()).rejects.toThrow();

    // Secret deletion should not have been attempted
    expect(mockDeleteSecret).not.toHaveBeenCalled();
  });
});
