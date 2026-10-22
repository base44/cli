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

  it("keeps parallel commands logged in when they refresh with the same rotating token", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));

    // The server rotates refresh tokens: the original works once, then is rejected.
    const tokenRequests: Array<() => void> = [];
    let refreshTokenUsed = false;
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      const respond = () => {
        if (refreshTokenUsed) {
          res.status(400).json({ error: "invalid_grant" });
          return;
        }
        refreshTokenUsed = true;
        res.json({
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      };
      const releaseAll = () => {
        for (const held of tokenRequests.splice(0)) held();
      };
      // Hold the first refresh until the second process asks too (or 2s pass).
      tokenRequests.push(respond);
      if (tokenRequests.length === 1) {
        setTimeout(releaseAll, 2000);
      } else {
        releaseAll();
      }
    });
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/agent-configs`, (req, res) => {
      if (req.headers.authorization !== "Bearer rotated-access-token") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      res.json({ created: [], updated: [], deleted: [] });
    });

    const results = await Promise.all([
      t.run("agents", "push", "--yes"),
      t.run("agents", "push", "--yes"),
    ]);

    for (const result of results) {
      t.expectResult(result).toSucceed();
    }
    const auth = await t.readAuthFile();
    expect(auth?.refreshToken).toBe("rotated-refresh-token");
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
  });
});
