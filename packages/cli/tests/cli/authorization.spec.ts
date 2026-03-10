import { describe, it } from "vitest";
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

    const result = await t.run("agents", "push");

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

    const result = await t.run("entities", "push");

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

    const result = await t.run("agents", "push");

    t.expectResult(result).toFail();
  });
});
