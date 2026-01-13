import { describe, it, expect } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("login command", () => {
  const { kit } = setupCLITests();

  it("shows help when called with --help", async () => {
    const result = await kit().run("login", "--help");

    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Authenticate with Base44");
  });

  it("completes login flow and saves auth file", async () => {
    // Given: mock OAuth endpoints
    kit().givenRoute("POST", "/oauth/device/code", () => ({
      body: {
        device_code: "test-device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://app.base44.com/device",
        expires_in: 300,
        interval: 1, // 1 second for fast polling
      },
    }));

    // Mock token endpoint - return token immediately (no pending state)
    kit().givenRoute("POST", "/oauth/token", () => ({
      body: {
        access_token: "test-access-token-from-login",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "test-refresh-token-from-login",
        scope: "apps:read apps:write",
      },
    }));

    // Mock userinfo endpoint
    kit().givenRoute("GET", "/oauth/userinfo", () => ({
      body: {
        email: "logged-in@example.com",
        name: "Logged In User",
      },
    }));

    // When: run login command
    const result = await kit().run("login");

    // Then: command succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Device code generated");
    kit().expect(result).toContain("ABCD-1234");
    kit().expect(result).toContain("Successfully logged in");
    kit().expect(result).toContain("logged-in@example.com");

    // And: auth file is created with correct data
    const authData = await kit().readAuthFile();
    expect(authData).not.toBeNull();
    expect(authData?.accessToken).toBe("test-access-token-from-login");
    expect(authData?.refreshToken).toBe("test-refresh-token-from-login");
    expect(authData?.email).toBe("logged-in@example.com");
    expect(authData?.name).toBe("Logged In User");
    expect(authData?.expiresAt).toBeGreaterThan(Date.now());
  });
});
