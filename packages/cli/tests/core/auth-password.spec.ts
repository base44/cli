import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  hasAnyLoginMethod,
  updatePasswordAuth,
} from "../../src/core/auth-config/api.js";
import type { AuthConfig } from "../../src/core/auth-config/schema.js";

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

describe("updatePasswordAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends enable_username_password: true when enabling", async () => {
    mockGet.mockResolvedValue(
      mockAppResponse({ enable_username_password: false }),
    );
    mockPut.mockResolvedValue(
      mockAppResponse({ enable_username_password: true }),
    );

    const result = await updatePasswordAuth(true);

    expect(result.enableUsernamePassword).toBe(true);
    const putCall = mockPut.mock.calls[0];
    const payload = putCall[1].json.auth_config;
    expect(payload.enable_username_password).toBe(true);
  });

  it("sends enable_username_password: false when disabling", async () => {
    mockGet.mockResolvedValue(
      mockAppResponse({ enable_username_password: true }),
    );
    mockPut.mockResolvedValue(
      mockAppResponse({ enable_username_password: false }),
    );

    const result = await updatePasswordAuth(false);

    expect(result.enableUsernamePassword).toBe(false);
    const putCall = mockPut.mock.calls[0];
    const payload = putCall[1].json.auth_config;
    expect(payload.enable_username_password).toBe(false);
  });

  it("returns parsed AuthConfig from response", async () => {
    mockGet.mockResolvedValue(mockAppResponse());
    mockPut.mockResolvedValue(
      mockAppResponse({
        enable_username_password: true,
        enable_google_login: true,
      }),
    );

    const result = await updatePasswordAuth(true);

    expect(result.enableUsernamePassword).toBe(true);
    expect(result.enableGoogleLogin).toBe(true);
    expect(result.ssoProviderName).toBeNull();
  });

  it("throws on HTTP failure", async () => {
    mockGet.mockResolvedValue(mockAppResponse());
    mockPut.mockRejectedValue(new Error("Server error"));

    await expect(updatePasswordAuth(true)).rejects.toThrow();
  });
});

describe("hasAnyLoginMethod", () => {
  const allDisabled: AuthConfig = {
    enableUsernamePassword: false,
    enableGoogleLogin: false,
    enableMicrosoftLogin: false,
    enableFacebookLogin: false,
    enableAppleLogin: false,
    ssoProviderName: null,
    enableSSOLogin: false,
    googleOAuthMode: "default",
    googleOAuthClientId: null,
    useWorkspaceSSO: false,
  };

  it("returns true when only password is enabled", () => {
    expect(
      hasAnyLoginMethod({ ...allDisabled, enableUsernamePassword: true }),
    ).toBe(true);
  });

  it("returns true when only a social provider is enabled", () => {
    expect(hasAnyLoginMethod({ ...allDisabled, enableGoogleLogin: true })).toBe(
      true,
    );
  });

  it("returns true when only SSO is enabled", () => {
    expect(hasAnyLoginMethod({ ...allDisabled, enableSSOLogin: true })).toBe(
      true,
    );
  });

  it("returns false when all methods are disabled", () => {
    expect(hasAnyLoginMethod(allDisabled)).toBe(false);
  });
});
