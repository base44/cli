import { HttpResponse, http } from "msw";
import { describe, it } from "vitest";
import { fixture, mswServer, setupCLITests } from "./testkit/index.js";

const BASE_URL = "https://app.base44.com";
const APP_ID = "test-app-id";

function mockTokenRefresh() {
  mswServer.use(
    http.post(`${BASE_URL}/oauth/token`, () =>
      HttpResponse.json({
        access_token: "refreshed-access-token",
        refresh_token: "refreshed-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    ),
  );
}

/**
 * Creates an MSW handler that returns 401 on the first call,
 * then delegates to a success handler on subsequent calls.
 */
function firstCall401ThenSuccess(
  method: "put" | "post",
  url: string,
  successBody: Record<string, unknown>,
) {
  let callCount = 0;
  mswServer.use(
    http[method](url, () => {
      callCount++;
      if (callCount === 1) {
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return HttpResponse.json(successBody);
    }),
  );
}

describe("token refresh on 401", () => {
  const t = setupCLITests();

  it("retries PUT with json body after 401 token refresh", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    mockTokenRefresh();
    firstCall401ThenSuccess(
      "put",
      `${BASE_URL}/api/apps/${APP_ID}/agent-configs`,
      {
        created: ["customer_support", "data_analyst", "order_assistant"],
        updated: [],
        deleted: [],
      },
    );

    const result = await t.run("agents", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agents pushed successfully");
  });

  it("retries PUT with json body after 401 token refresh (entities)", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    mockTokenRefresh();
    firstCall401ThenSuccess(
      "put",
      `${BASE_URL}/api/apps/${APP_ID}/entity-schemas`,
      {
        created: ["tasks"],
        updated: [],
        deleted: [],
      },
    );

    const result = await t.run("entities", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Entities pushed");
  });

  it("fails with actual error when token refresh also fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));

    // Token refresh returns 401 too (refresh token is also expired)
    mswServer.use(
      http.post(`${BASE_URL}/oauth/token`, () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 401 }),
      ),
    );

    // Agent push always returns 401
    mswServer.use(
      http.put(`${BASE_URL}/api/apps/${APP_ID}/agent-configs`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );

    const result = await t.run("agents", "push");

    t.expectResult(result).toFail();
  });
});
