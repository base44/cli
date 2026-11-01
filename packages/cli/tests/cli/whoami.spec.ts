import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const USER = { email: "test@example.com", name: "Test User" };

describe("whoami command", () => {
  const t = setupCLITests();

  /** Records any device-code request: whoami must never start a login. */
  function trackDeviceCodeRequests(): { requested: boolean } {
    const tracker = { requested: false };
    t.api.mockRoute("POST", "/oauth/device/code", (_req, res) => {
      tracker.requested = true;
      res.status(500).json({ error: "unexpected login" });
    });
    return tracker;
  }

  /** Answers userinfo with USER and records the bearer it was sent. */
  function mockUserInfoRecordingAuth(): { authorization?: string } {
    const seen: { authorization?: string } = {};
    t.api.mockRoute("GET", "/oauth/userinfo", (req, res) => {
      seen.authorization = req.headers.authorization;
      res.status(200).json(USER);
    });
    return seen;
  }

  it("--json wraps the human output in a JSON envelope (generic fallback)", async () => {
    // whoami has no native JSON output; --json should still yield valid JSON.
    await t.givenLoggedIn(USER);
    t.api.mockUserInfo(USER);

    const result = await t.run("whoami", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.output).toContain("test@example.com");
  });

  it("verifies the stored session with the server", async () => {
    await t.givenLoggedIn(USER);
    const userInfo = mockUserInfoRecordingAuth();

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logged in as:");
    t.expectResult(result).toContain("test@example.com");
    expect(userInfo.authorization).toBe("Bearer test-access-token");
  });

  it("shows the email the server reports", async () => {
    await t.givenLoggedIn({
      email: "another-user@company.org",
      name: "Another User",
    });
    t.api.mockUserInfo({
      email: "another-user@company.org",
      name: "Another User",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("another-user@company.org");
  });

  it("refreshes an expired access token before verifying", async () => {
    await t.givenLoggedIn(USER, { expired: true });
    t.api.mockToken({
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    });
    const userInfo = mockUserInfoRecordingAuth();

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("test@example.com");
    expect(userInfo.authorization).toBe("Bearer refreshed-access-token");
    const auth = await t.readAuthFile();
    expect(auth?.accessToken).toBe("refreshed-access-token");
  });

  it("refreshes and retries once when the server rejects an unexpired token", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockToken({
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    });
    t.api.mockRoute("GET", "/oauth/userinfo", (req, res) => {
      if (req.headers.authorization === "Bearer refreshed-access-token") {
        res.status(200).json(USER);
      } else {
        res.status(401).json({ error: "Unauthorized" });
      }
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("test@example.com");
  });

  it("fails as expired, without starting a login, when the refresh token is rejected", async () => {
    await t.givenLoggedIn(USER, { expired: true });
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      res.status(400).json({ error: "invalid_grant" });
    });
    t.api.mockRoute("GET", "/oauth/userinfo", (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
    });
    const deviceCode = trackDeviceCodeRequests();

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("session has expired");
    t.expectResult(result).toContain("base44 login");
    t.expectResult(result).toNotContain("Logged in as");
    expect(deviceCode.requested).toBe(false);
  });

  it("reports AUTH_EXPIRED in the --json error envelope", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      res.status(400).json({ error: "invalid_grant" });
    });
    t.api.mockRoute("GET", "/oauth/userinfo", (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
    });

    const result = await t.run("whoami", "--json");

    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("fails as not logged in, without starting a login, when there are no credentials", async () => {
    const deviceCode = trackDeviceCodeRequests();

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Not logged in");
    t.expectResult(result).toContain("base44 login");
    expect(deviceCode.requested).toBe(false);
  });

  it("keeps the login and says it couldn't verify when the server errors", async () => {
    await t.givenLoggedIn(USER);
    const authBefore = await t.readAuthFile();
    t.api.mockError("get", "/oauth/userinfo", {
      status: 500,
      body: { error: "Internal Server Error" },
    });

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("verifying the session");
    t.expectResult(result).toNotContain("Logged in as");
    t.expectResult(result).toNotContain("expired");
    expect(await t.readAuthFile()).toEqual(authBefore);
  });

  it("keeps the login when the server can't be reached", async () => {
    await t.givenLoggedIn(USER);
    const authBefore = await t.readAuthFile();
    t.api.mockRoute("GET", "/oauth/userinfo", (req) => {
      req.socket.destroy();
    });

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("verifying the session");
    t.expectResult(result).toNotContain("expired");
    expect(await t.readAuthFile()).toEqual(authBefore);
  });

  it("keeps an expired login when the server errors while renewing it", async () => {
    await t.givenLoggedIn(USER, { expired: true });
    const authBefore = await t.readAuthFile();
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      res.status(500).json({ error: "server_error" });
    });
    t.api.mockError("get", "/oauth/userinfo", {
      status: 500,
      body: { error: "Internal Server Error" },
    });

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("verifying the session");
    expect(await t.readAuthFile()).toEqual(authBefore);
  });
});
