import { describe, expect, it } from "vitest";
import type {
  CustomSSOCredentials,
  GitHubSSOCredentials,
  GoogleSSOCredentials,
  MicrosoftSSOCredentials,
  OktaSSOCredentials,
  SSOCredentials,
} from "../../src/cli/commands/sso/providers/types.js";

/**
 * These tests verify the SSOCredentials type system:
 * - Each provider type has only its required fields
 * - The union type accepts all provider types
 * - The buildSecretsPayload-compatible key mapping works
 */

const CREDENTIALS_KEY_MAP: Record<string, string> = {
  ssoName: "sso_name",
  ssoClientId: "sso_client_id",
  ssoClientSecret: "sso_client_secret",
  ssoScope: "sso_scope",
  ssoDiscoveryUrl: "sso_discovery_url",
  ssoTenantId: "sso_tenant_id",
  ssoAuthEndpoint: "sso_auth_endpoint",
  ssoTokenEndpoint: "sso_token_endpoint",
  ssoUserinfoEndpoint: "sso_userinfo_endpoint",
  ssoOktaDomain: "sso_okta_domain",
  ssoJwksUri: "sso_jwks_uri",
};

function buildSecretsPayload(
  credentials: SSOCredentials,
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [camelKey, snakeKey] of Object.entries(CREDENTIALS_KEY_MAP)) {
    const value = (credentials as unknown as Record<string, unknown>)[camelKey];
    if (typeof value === "string" && value.length > 0) {
      secrets[snakeKey] = value;
    }
  }
  return secrets;
}

describe("Google SSO credentials", () => {
  const google: GoogleSSOCredentials = {
    ssoName: "google",
    ssoClientId: "client-id",
    ssoClientSecret: "client-secret",
    ssoScope: "openid email profile",
    ssoDiscoveryUrl:
      "https://accounts.google.com/.well-known/openid-configuration",
  };

  it("builds correct secrets payload", () => {
    const payload = buildSecretsPayload(google);

    expect(payload).toEqual({
      sso_name: "google",
      sso_client_id: "client-id",
      sso_client_secret: "client-secret",
      sso_scope: "openid email profile",
      sso_discovery_url:
        "https://accounts.google.com/.well-known/openid-configuration",
    });
  });

  it("does not include provider-specific fields from other providers", () => {
    const payload = buildSecretsPayload(google);

    expect(payload).not.toHaveProperty("sso_tenant_id");
    expect(payload).not.toHaveProperty("sso_auth_endpoint");
    expect(payload).not.toHaveProperty("sso_okta_domain");
    expect(payload).not.toHaveProperty("sso_jwks_uri");
  });
});

describe("Microsoft SSO credentials", () => {
  const microsoft: MicrosoftSSOCredentials = {
    ssoName: "microsoft",
    ssoClientId: "client-id",
    ssoClientSecret: "client-secret",
    ssoScope: "openid email profile",
    ssoDiscoveryUrl:
      "https://login.microsoftonline.com/tenant-123/v2.0/.well-known/openid-configuration",
    ssoTenantId: "tenant-123",
  };

  it("builds correct secrets payload with tenant ID", () => {
    const payload = buildSecretsPayload(microsoft);

    expect(payload).toEqual({
      sso_name: "microsoft",
      sso_client_id: "client-id",
      sso_client_secret: "client-secret",
      sso_scope: "openid email profile",
      sso_discovery_url:
        "https://login.microsoftonline.com/tenant-123/v2.0/.well-known/openid-configuration",
      sso_tenant_id: "tenant-123",
    });
  });
});

describe("GitHub SSO credentials", () => {
  const github: GitHubSSOCredentials = {
    ssoName: "github",
    ssoClientId: "client-id",
    ssoClientSecret: "client-secret",
    ssoScope: "user:email",
    ssoAuthEndpoint: "https://github.com/login/oauth/authorize",
    ssoTokenEndpoint: "https://github.com/login/oauth/access_token",
    ssoUserinfoEndpoint: "https://api.github.com/user",
  };

  it("builds correct secrets payload with endpoints", () => {
    const payload = buildSecretsPayload(github);

    expect(payload).toEqual({
      sso_name: "github",
      sso_client_id: "client-id",
      sso_client_secret: "client-secret",
      sso_scope: "user:email",
      sso_auth_endpoint: "https://github.com/login/oauth/authorize",
      sso_token_endpoint: "https://github.com/login/oauth/access_token",
      sso_userinfo_endpoint: "https://api.github.com/user",
    });
  });

  it("does not include discovery URL", () => {
    const payload = buildSecretsPayload(github);
    expect(payload).not.toHaveProperty("sso_discovery_url");
  });
});

describe("Okta SSO credentials", () => {
  const okta: OktaSSOCredentials = {
    ssoName: "okta",
    ssoClientId: "client-id",
    ssoClientSecret: "client-secret",
    ssoScope: "openid email profile",
    ssoDiscoveryUrl: "https://my-org.okta.com/.well-known/openid-configuration",
    ssoOktaDomain: "my-org.okta.com",
  };

  it("builds correct secrets payload with Okta domain", () => {
    const payload = buildSecretsPayload(okta);

    expect(payload).toEqual({
      sso_name: "okta",
      sso_client_id: "client-id",
      sso_client_secret: "client-secret",
      sso_scope: "openid email profile",
      sso_discovery_url:
        "https://my-org.okta.com/.well-known/openid-configuration",
      sso_okta_domain: "my-org.okta.com",
    });
  });
});

describe("Custom SSO credentials", () => {
  it("builds correct secrets payload with all manual fields", () => {
    const custom: CustomSSOCredentials = {
      ssoName: "my-idp",
      ssoClientId: "client-id",
      ssoClientSecret: "client-secret",
      ssoScope: "openid email profile",
      ssoDiscoveryUrl:
        "https://idp.example.com/.well-known/openid-configuration",
      ssoAuthEndpoint: "https://idp.example.com/authorize",
      ssoTokenEndpoint: "https://idp.example.com/token",
      ssoUserinfoEndpoint: "https://idp.example.com/userinfo",
      ssoJwksUri: "https://idp.example.com/.well-known/jwks.json",
    };

    const payload = buildSecretsPayload(custom);

    expect(payload).toEqual({
      sso_name: "my-idp",
      sso_client_id: "client-id",
      sso_client_secret: "client-secret",
      sso_scope: "openid email profile",
      sso_discovery_url:
        "https://idp.example.com/.well-known/openid-configuration",
      sso_auth_endpoint: "https://idp.example.com/authorize",
      sso_token_endpoint: "https://idp.example.com/token",
      sso_userinfo_endpoint: "https://idp.example.com/userinfo",
      sso_jwks_uri: "https://idp.example.com/.well-known/jwks.json",
    });
  });

  it("omits optional discovery URL when not provided", () => {
    const custom: CustomSSOCredentials = {
      ssoName: "my-idp",
      ssoClientId: "client-id",
      ssoClientSecret: "client-secret",
      ssoScope: "openid email profile",
      ssoAuthEndpoint: "https://idp.example.com/authorize",
      ssoTokenEndpoint: "https://idp.example.com/token",
      ssoUserinfoEndpoint: "https://idp.example.com/userinfo",
      ssoJwksUri: "https://idp.example.com/.well-known/jwks.json",
    };

    const payload = buildSecretsPayload(custom);

    expect(payload).not.toHaveProperty("sso_discovery_url");
  });
});
