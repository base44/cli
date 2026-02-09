import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("login command", () => {
  const t = setupCLITests();

  it("completes login flow and saves auth file", async () => {
    t.api.mockDeviceCode({
      device_code: "test-device-code",
      user_code: "ABCD-1234",
      verification_uri: "https://app.base44.com/device",
      expires_in: 300,
      interval: 1,
    });
    t.api.mockToken({
      access_token: "test-access-token-from-login",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "test-refresh-token-from-login",
    });
    t.api.mockUserInfo({
      email: "logged-in@example.com",
      name: "Logged In User",
    });

    const result = await t.run("login");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Device code generated");
    t.expectResult(result).toContain("ABCD-1234");
    t.expectResult(result).toContain("Successfully logged in");
    t.expectResult(result).toContain("logged-in@example.com");

    // Auth file is created with correct data
    const authData = await t.readAuthFile();
    expect(authData).not.toBeNull();
    expect(authData?.accessToken).toBe("test-access-token-from-login");
    expect(authData?.refreshToken).toBe("test-refresh-token-from-login");
    expect(authData?.email).toBe("logged-in@example.com");
    expect(authData?.name).toBe("Logged In User");
    expect(authData?.expiresAt).toBeGreaterThan(Date.now());
  });
});
