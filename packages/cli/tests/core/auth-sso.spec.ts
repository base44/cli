import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock secrets API
const mockSetSecrets = vi.fn();
const mockDeleteSecret = vi.fn();
vi.mock("../../src/core/resources/secret/index.js", () => ({
  setSecrets: (...args: unknown[]) => mockSetSecrets(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
}));

import {
  readAuthConfig,
  writeAuthConfig,
} from "../../src/core/resources/auth-config/config.js";
import type { AuthConfig } from "../../src/core/resources/auth-config/schema.js";
import {
  buildSSOSecrets,
  deleteSSOSecrets,
  KNOWN_SSO_PROVIDERS,
  updateSSOConfig,
} from "../../src/core/resources/auth-config/sso/index.js";

const ALL_DISABLED: AuthConfig = {
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

describe("updateSSOConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "auth-sso-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enables SSO with provider name", async () => {
    await writeAuthConfig(tempDir, ALL_DISABLED);

    const result = await updateSSOConfig(tempDir, "google", true);

    expect(result.enableSSOLogin).toBe(true);
    expect(result.ssoProviderName).toBe("google");

    const saved = await readAuthConfig(tempDir);
    expect(saved?.enableSSOLogin).toBe(true);
    expect(saved?.ssoProviderName).toBe("google");
  });

  it("disables SSO and clears provider name", async () => {
    await writeAuthConfig(tempDir, {
      ...ALL_DISABLED,
      enableSSOLogin: true,
      ssoProviderName: "okta",
    });

    const result = await updateSSOConfig(tempDir, null, false);

    expect(result.enableSSOLogin).toBe(false);
    expect(result.ssoProviderName).toBeNull();

    const saved = await readAuthConfig(tempDir);
    expect(saved?.enableSSOLogin).toBe(false);
    expect(saved?.ssoProviderName).toBeNull();
  });

  it("creates config file when none exists", async () => {
    const result = await updateSSOConfig(tempDir, "microsoft", true);

    expect(result.enableSSOLogin).toBe(true);
    expect(result.ssoProviderName).toBe("microsoft");

    const saved = await readAuthConfig(tempDir);
    expect(saved).not.toBeNull();
  });

  it("preserves non-social fields and disables social login when enabling SSO", async () => {
    await writeAuthConfig(tempDir, {
      ...ALL_DISABLED,
      enableUsernamePassword: true,
      enableGoogleLogin: true,
    });

    const result = await updateSSOConfig(tempDir, "okta", true);

    expect(result.enableUsernamePassword).toBe(true);
    expect(result.enableSSOLogin).toBe(true);
    // SSO and social login are mutually exclusive
    expect(result.enableGoogleLogin).toBe(false);
  });
});

describe("buildSSOSecrets", () => {
  const baseOptions = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  };

  it("builds google secrets with defaults", () => {
    const secrets = buildSSOSecrets("google", baseOptions);

    expect(secrets.sso_name).toBe("google");
    expect(secrets.sso_client_id).toBe("test-client-id");
    expect(secrets.sso_client_secret).toBe("test-client-secret");
    expect(secrets.sso_scope).toBe("openid email profile");
    expect(secrets.sso_discovery_url).toBe(
      "https://accounts.google.com/.well-known/openid-configuration",
    );
  });

  it("builds microsoft secrets with tenant-derived discovery URL", () => {
    const secrets = buildSSOSecrets("microsoft", {
      ...baseOptions,
      tenantId: "my-tenant",
    });

    expect(secrets.sso_tenant_id).toBe("my-tenant");
    expect(secrets.sso_discovery_url).toBe(
      "https://login.microsoftonline.com/my-tenant/v2.0/.well-known/openid-configuration",
    );
  });

  it("throws when microsoft is missing tenant-id", () => {
    expect(() => buildSSOSecrets("microsoft", baseOptions)).toThrow(
      "sso_tenant_id",
    );
  });

  it("builds github secrets with endpoint defaults", () => {
    const secrets = buildSSOSecrets("github", baseOptions);

    expect(secrets.sso_scope).toBe("user:email");
    expect(secrets.sso_auth_endpoint).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(secrets.sso_token_endpoint).toBe(
      "https://github.com/login/oauth/access_token",
    );
    expect(secrets.sso_userinfo_endpoint).toBe("https://api.github.com/user");
  });

  it("builds okta secrets with domain-derived discovery URL", () => {
    const secrets = buildSSOSecrets("okta", {
      ...baseOptions,
      oktaDomain: "myorg.okta.com",
    });

    expect(secrets.sso_okta_domain).toBe("myorg.okta.com");
    expect(secrets.sso_discovery_url).toBe(
      "https://myorg.okta.com/.well-known/openid-configuration",
    );
  });

  it("throws when okta is missing okta-domain", () => {
    expect(() => buildSSOSecrets("okta", baseOptions)).toThrow(
      "sso_okta_domain",
    );
  });

  it("throws when custom is missing required endpoints", () => {
    expect(() =>
      buildSSOSecrets("custom", { ...baseOptions, ssoName: "my-idp" }),
    ).toThrow("sso_auth_endpoint");
  });

  it("throws when custom is missing sso-name", () => {
    expect(() =>
      buildSSOSecrets("custom", {
        ...baseOptions,
        authEndpoint: "https://a",
        tokenEndpoint: "https://b",
        userinfoEndpoint: "https://c",
        jwksUri: "https://d",
      }),
    ).toThrow("sso_name");
  });

  it("allows overriding defaults", () => {
    const secrets = buildSSOSecrets("google", {
      ...baseOptions,
      scope: "openid",
      discoveryUrl:
        "https://custom.example.com/.well-known/openid-configuration",
    });

    expect(secrets.sso_scope).toBe("openid");
    expect(secrets.sso_discovery_url).toBe(
      "https://custom.example.com/.well-known/openid-configuration",
    );
  });

  it("exports all known providers", () => {
    expect(Object.keys(KNOWN_SSO_PROVIDERS)).toEqual([
      "google",
      "microsoft",
      "github",
      "okta",
      "custom",
    ]);
  });
});

describe("deleteSSOSecrets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDeleteSecret.mockResolvedValue(undefined);
  });

  it("attempts to delete all known SSO secret keys", async () => {
    await deleteSSOSecrets();

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

  it("does not throw when individual deletes fail", async () => {
    mockDeleteSecret.mockRejectedValue(new Error("not found"));

    await expect(deleteSSOSecrets()).resolves.not.toThrow();
  });
});
