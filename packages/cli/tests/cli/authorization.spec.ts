import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";

describe("token refresh on 401", () => {
  const t = setupCLITests();

  function mockTokenRefresh() {
    t.api.mockToken({
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    });
  }

  /**
   * Registers a handler that returns 401 on the first call,
   * then returns the success body on subsequent calls.
   */
  function firstCall401ThenSuccess(
    method: "PUT" | "POST",
    path: string,
    successBody: Record<string, unknown>,
  ) {
    let callCount = 0;
    t.api.mockRoute(method, path, (_req, res) => {
      callCount++;
      if (callCount === 1) {
        res.status(401).json({ error: "Unauthorized" });
      } else {
        res.status(200).json(successBody);
      }
    });
  }

  it("retries PUT with json body after 401 token refresh", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    mockTokenRefresh();
    firstCall401ThenSuccess("PUT", `/api/apps/${APP_ID}/agent-configs`, {
      created: ["customer_support", "data_analyst", "order_assistant"],
      updated: [],
      deleted: [],
    });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agents pushed successfully");
  });

  it("retries PUT with json body after 401 token refresh (entities)", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    mockTokenRefresh();
    firstCall401ThenSuccess("PUT", `/api/apps/${APP_ID}/entity-schemas`, {
      created: ["tasks"],
      updated: [],
      deleted: [],
    });

    const result = await t.run("entities", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Entities pushed");
  });

  it("fails with actual error when token refresh also fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));

    // Token refresh returns 401 (refresh token is also expired)
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      res.status(401).json({ error: "invalid_grant" });
    });

    // Agent push always returns 401
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/agent-configs`, (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
    });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toFail();
    // Assert the real auth-failure reason, not just a non-zero exit — otherwise
    // an unrelated early failure (e.g. a missing --yes guard) would pass this.
    t.expectResult(result).toContain("Unauthorized");
    // The server refused the refresh token, so the stored login is gone.
    expect(await t.readAuthFile()).toBeNull();
  });

  it("keeps the stored login when the token endpoint fails with a server error", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    const authBefore = await t.readAuthFile();
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      res.status(503).json({ error: "temporarily_unavailable" });
    });
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/agent-configs`, (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
    });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toFail();
    expect(await t.readAuthFile()).toEqual(authBefore);
  });
});

describe("login required while logged out", () => {
  const t = setupCLITests();

  /** Records any device-code request the CLI makes. */
  function trackDeviceCodeRequests(): { requested: boolean } {
    const tracker = { requested: false };
    t.api.mockRoute("POST", "/oauth/device/code", (_req, res) => {
      tracker.requested = true;
      res.status(200).json({
        device_code: "dev-code",
        user_code: "ABCD-1234",
        verification_uri: "https://app.base44.com/device",
        expires_in: 1,
        interval: 1,
      });
    });
    return tracker;
  }

  it("fails fast instead of starting a login when there's no terminal", async () => {
    // Tests run without a TTY, so the CLI is non-interactive.
    const deviceCode = trackDeviceCodeRequests();

    const result = await t.run("workspace", "list");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("needs you to be logged in");
    t.expectResult(result).toContain("base44 login");
    t.expectResult(result).toContain("BASE44_API_KEY");
    t.expectResult(result).toContain("BASE44_ACCESS_TOKEN");
    t.expectResult(result).toNotContain("ABCD-1234");
    expect(deviceCode.requested).toBe(false);
  });

  it("reports AUTH_REQUIRED in the --json error envelope", async () => {
    const deviceCode = trackDeviceCodeRequests();

    const result = await t.run("workspace", "list", "--json");

    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(deviceCode.requested).toBe(false);
  });
});
