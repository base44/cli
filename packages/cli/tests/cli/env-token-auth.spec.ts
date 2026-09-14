import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sign } from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";

/** Build a signed JWT with the given claims (seeding decodes, never verifies). */
function makeJwt(claims: Record<string, unknown>): string {
  return sign(claims, "test-secret");
}

describe("env credential seeding", () => {
  const t = setupCLITests();

  const futureExp = () => Math.floor(Date.now() / 1000) + 3600;

  it("seeds a standard auth.json from env credentials", async () => {
    // No givenLoggedIn(): the only credentials are env vars. The ensureAuth
    // middleware should decode them and write a standard auth file.
    const exp = futureExp();
    const jwt = makeJwt({ sub: "alice@example.com", exp });
    t.givenEnv({
      BASE44_ACCESS_TOKEN: jwt,
      BASE44_REFRESH_TOKEN: "refresh-xyz",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();

    const auth = await t.readAuthFile();
    expect(auth).toMatchObject({
      accessToken: jwt,
      refreshToken: "refresh-xyz",
      email: "alice@example.com",
      name: "alice@example.com",
      expiresAt: exp * 1000,
    });
  });

  it("shows the seeded identity in whoami", async () => {
    t.givenEnv({
      BASE44_ACCESS_TOKEN: makeJwt({
        sub: "alice@example.com",
        exp: futureExp(),
      }),
      BASE44_REFRESH_TOKEN: "refresh-xyz",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("alice@example.com");
  });

  it("uses the seeded token as the bearer for API calls", async () => {
    await t.givenProject(fixture("with-entities"));
    const jwt = makeJwt({ sub: "alice@example.com", exp: futureExp() });
    t.givenEnv({
      BASE44_ACCESS_TOKEN: jwt,
      BASE44_REFRESH_TOKEN: "refresh-xyz",
    });

    let authHeader: string | undefined;
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/entity-schemas`, (req, res) => {
      authHeader = req.headers.authorization;
      res.status(200).json({ created: ["customer"], updated: [], deleted: [] });
    });

    const result = await t.run("entities", "push", "--yes");

    t.expectResult(result).toSucceed();
    expect(authHeader).toBe(`Bearer ${jwt}`);
  });

  it("shows workspace API key auth in whoami without a stored login", async () => {
    t.givenEnv({
      BASE44_API_KEY:
        "b44k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Using workspace API key: b44k_aaaaa");
    expect(await t.readAuthFile()).toBeNull();
  });

  it("uses BASE44_API_KEY as the api_key header for API calls", async () => {
    await t.givenProject(fixture("with-entities"));
    const workspaceApiKey =
      "b44k_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    t.givenEnv({ BASE44_API_KEY: workspaceApiKey });

    let apiKeyHeader: string | undefined;
    let authHeader: string | undefined;
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/entity-schemas`, (req, res) => {
      apiKeyHeader = req.headers.api_key as string | undefined;
      authHeader = req.headers.authorization;
      res.status(200).json({ created: ["customer"], updated: [], deleted: [] });
    });

    const result = await t.run("entities", "push", "--yes");

    t.expectResult(result).toSucceed();
    expect(apiKeyHeader).toBe(workspaceApiKey);
    expect(authHeader).toBeUndefined();
    expect(await t.readAuthFile()).toBeNull();
  });

  it("gives a workspace-key hint (not 'base44 login') on a rejected key", async () => {
    await t.givenProject(fixture("with-entities"));
    t.givenEnv({
      BASE44_API_KEY:
        "b44k_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    t.api.mockEntitiesPushError({
      status: 401,
      body: { error: "Unauthorized", detail: "Invalid API key" },
    });

    const result = await t.run("entities", "push", "--yes");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("workspace API key");
    t.expectResult(result).toNotContain("base44 login");
  });

  it("reconciles connectors through the deployment endpoint with a workspace API key", async () => {
    // The connectors-list endpoint rejects workspace keys, so deploy must go
    // through the deployment sync route instead. With no local connectors it
    // still sends an empty list so stale remote connectors are removed, the
    // same as an OAuth deploy.
    await t.givenProject(fixture("with-entities"));
    const workspaceApiKey =
      "b44k_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    t.givenEnv({ BASE44_API_KEY: workspaceApiKey });
    t.api.mockEntitiesPush({
      created: ["Customer", "Product"],
      updated: [],
      deleted: [],
    });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsListError({
      status: 403,
      body: { error: "Forbidden", detail: "Workspace keys cannot list" },
    });

    let syncBody: unknown;
    let syncApiKeyHeader: string | undefined;
    t.api.mockRoute(
      "PUT",
      `/api/apps/${APP_ID}/deployment/connectors`,
      (req, res) => {
        syncBody = req.body;
        syncApiKeyHeader = req.headers.api_key as string | undefined;
        res.status(200).json({ connectors: [] });
      },
    );

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
    expect(syncApiKeyHeader).toBe(workspaceApiKey);
    expect(syncBody).toEqual({ connectors: [] });
  });

  it("deploys local connectors through the deployment endpoint with a workspace API key", async () => {
    await t.givenProject(fixture("with-connectors"));
    t.givenEnv({
      BASE44_API_KEY:
        "b44k_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsListError({
      status: 403,
      body: { error: "Forbidden", detail: "Workspace keys cannot list" },
    });
    t.api.mockConnectorSetError({
      status: 403,
      body: { error: "Forbidden", detail: "Workspace keys cannot set" },
    });

    let syncBody: unknown;
    t.api.mockRoute(
      "PUT",
      `/api/apps/${APP_ID}/deployment/connectors`,
      (req, res) => {
        syncBody = req.body;
        res.status(200).json(req.body);
      },
    );

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("3 connectors");
    expect(syncBody).toEqual({
      connectors: expect.arrayContaining([
        {
          integration_type: "googlecalendar",
          scopes: [
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
          ],
        },
        { integration_type: "notion", scopes: [] },
        { integration_type: "slack", scopes: ["chat:write", "channels:read"] },
      ]),
    });
  });

  it("reports the Stripe connector as unsupported with a workspace API key", async () => {
    // Stripe routes only accept platform-user auth. Rather than surfacing the
    // status call's auth failure, name the limitation and sync the rest.
    await t.givenProject(fixture("with-stripe-connector"));
    t.givenEnv({
      BASE44_API_KEY:
        "b44k_gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
    });
    let stripeStatusCalled = false;
    t.api.mockRoute(
      "GET",
      `/api/apps/${APP_ID}/payments/stripe/status`,
      (_req, res) => {
        stripeStatusCalled = true;
        res.status(401).json({ error: "Unauthorized" });
      },
    );
    t.api.mockDeploymentConnectorsSync({
      connectors: [{ integration_type: "slack", scopes: ["chat:write"] }],
    });

    const result = await t.run("connectors", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Synced: slack");
    t.expectResult(result).toContain(
      "Stripe connector sync is not supported with a workspace API key",
    );
    expect(stripeStatusCalled).toBe(false);
  });

  it("pushes auth config through the deployment endpoint with a workspace API key", async () => {
    await t.givenProject(fixture("with-entities"));
    const authDir = join(t.getTempDir(), "project", "base44", "auth");
    await mkdir(authDir, { recursive: true });
    await writeFile(
      join(authDir, "config.jsonc"),
      JSON.stringify({
        enableUsernamePassword: true,
        enableGoogleLogin: false,
        enableMicrosoftLogin: false,
        enableFacebookLogin: false,
        enableAppleLogin: false,
        ssoProviderName: null,
        enableSSOLogin: false,
        googleOAuthMode: "default",
        googleOAuthClientId: null,
        useWorkspaceSSO: false,
      }),
    );

    const workspaceApiKey =
      "b44k_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    t.givenEnv({ BASE44_API_KEY: workspaceApiKey });
    t.api.mockEntitiesPush({
      created: ["Customer", "Product"],
      updated: [],
      deleted: [],
    });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockDeploymentConnectorsSync({ connectors: [] });

    let deploymentAuthConfigBody: unknown;
    let deploymentApiKeyHeader: string | undefined;
    let genericAppUpdateCalled = false;
    t.api.mockRoute(
      "PUT",
      `/api/apps/${APP_ID}/deployment/auth-configuration`,
      (req, res) => {
        deploymentAuthConfigBody = req.body;
        deploymentApiKeyHeader = req.headers.api_key as string | undefined;
        res.status(200).json({ name: "auth_config", hash: "auth-hash" });
      },
    );
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}`, (_req, res) => {
      genericAppUpdateCalled = true;
      res.status(500).json({ error: "Unexpected generic app update" });
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    expect(deploymentApiKeyHeader).toBe(workspaceApiKey);
    expect(deploymentAuthConfigBody).toMatchObject({
      enable_username_password: true,
      enable_google_login: false,
    });
    expect(deploymentAuthConfigBody).not.toHaveProperty("auth_config");
    expect(genericAppUpdateCalled).toBe(false);
  });

  it("ignores a non-workspace BASE44_API_KEY when OAuth auth exists", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.givenEnv({ BASE44_API_KEY: "not-a-workspace-key" });

    let apiKeyHeader: string | undefined;
    let authHeader: string | undefined;
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/entity-schemas`, (req, res) => {
      apiKeyHeader = req.headers.api_key as string | undefined;
      authHeader = req.headers.authorization;
      res.status(200).json({ created: ["customer"], updated: [], deleted: [] });
    });

    const result = await t.run("entities", "push", "--yes");

    t.expectResult(result).toSucceed();
    expect(apiKeyHeader).toBeUndefined();
    expect(authHeader).toBe("Bearer test-access-token");
  });

  it("does not overwrite a stored login when env credentials are incomplete", async () => {
    await t.givenLoggedIn({ email: "real@example.com", name: "Real User" });
    // Access token present but no refresh token → can't form a standard record,
    // so seeding is skipped and the existing login is left untouched.
    t.givenEnv({
      BASE44_ACCESS_TOKEN: makeJwt({
        sub: "alice@example.com",
        exp: futureExp(),
      }),
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("real@example.com");
    const auth = await t.readAuthFile();
    expect(auth?.email).toBe("real@example.com");
  });
});
