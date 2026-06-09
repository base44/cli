import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";

describe("env access token authentication", () => {
  const t = setupCLITests();

  it("uses BASE44_ACCESS_TOKEN as the bearer token for API calls", async () => {
    // No givenLoggedIn(): the only credential is the env access token. This
    // verifies the token is sent verbatim, with no stored auth and no refresh.
    await t.givenProject(fixture("with-entities"));
    t.givenEnv({ BASE44_ACCESS_TOKEN: "env-access-token-xyz" });

    let authHeader: string | undefined;
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/entity-schemas`, (req, res) => {
      authHeader = req.headers.authorization;
      res.status(200).json({ created: ["customer"], updated: [], deleted: [] });
    });

    const result = await t.run("entities", "push");

    t.expectResult(result).toSucceed();
    expect(authHeader).toBe("Bearer env-access-token-xyz");
  });

  it("does not attempt an OAuth refresh on 401 when using an env token", async () => {
    await t.givenProject(fixture("with-entities"));
    t.givenEnv({ BASE44_ACCESS_TOKEN: "env-access-token-xyz" });

    // If the client tried to refresh, it would call POST /oauth/token. We make
    // that fail loudly so an unexpected refresh attempt is observable.
    let refreshAttempted = false;
    t.api.mockRoute("POST", "/oauth/token", (_req, res) => {
      refreshAttempted = true;
      res.status(500).json({ error: "should-not-be-called" });
    });
    t.api.mockRoute(
      "PUT",
      `/api/apps/${APP_ID}/entity-schemas`,
      (_req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      },
    );

    const result = await t.run("entities", "push");

    // The 401 should propagate as a failure, without a refresh round-trip.
    t.expectResult(result).toFail();
    expect(refreshAttempted).toBe(false);
  });
});
