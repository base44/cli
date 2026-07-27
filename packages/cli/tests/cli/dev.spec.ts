import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  createServiceAuthorizationHeader,
  SERVICE_ROLE_EMAIL,
} from "@/cli/dev/dev-server/auth/tokens.js";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

const expectServiceAuthorization = (value: unknown) => {
  expect(value).toEqual(expect.stringMatching(/^Bearer \S+$/));
  const token = (value as string).replace("Bearer ", "");
  expect(jwt.decode(token)?.sub).toBe(SERVICE_ROLE_EMAIL);
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

describe("dev command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("dev");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("rejects explicit --app-id", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const result = await t.run("dev", "--app-id", "injected-app-id");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "base44 dev cannot be used with --app-id or BASE44_APP_ID",
    );
  });

  it("rejects BASE44_APP_ID", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.givenEnv({ BASE44_APP_ID: "injected-app-id" });

    const result = await t.run("dev");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "base44 dev cannot be used with --app-id or BASE44_APP_ID",
    );
  });

  it("starts dev server successfully", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    const result = await handle.stop();

    t.expectResult(result).toSucceed();
  });

  it("redirects login requests to the published site", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const response = await fetch(`${devServerUrl}/login`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://test-app.base44.app/login",
    );

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("runs the frontend serveCommand with injected Base44 env vars", async () => {
    await t.givenLoggedInWithProject(fixture("with-serve-command"));

    const handle = await t.runLive("dev");
    await handle.waitForOutput(/SERVE_APP=/);
    await handle.stop();

    const output = handle.stdout.join("");
    expect(output).toContain(`SERVE_APP=${t.api.appId}`);
    expect(output).toContain("URL=http://localhost:");
    expect(output).toContain("[frontend]");
    // The backend is announced (labeled) before the frontend output.
    expect(output).toContain("Backend running on http://localhost:");
  });

  it("tears the dev server down when the frontend exits", async () => {
    // The fixture's serveCommand prints, then exits non-zero shortly after.
    await t.givenLoggedInWithProject(fixture("with-exiting-serve-command"));

    const handle = await t.runLive("dev");
    const result = await handle.waitForExit();

    expect(result.exitCode).not.toBe(0);
  });

  it("stops the frontend serveCommand when the dev server stops", async () => {
    await t.givenLoggedInWithProject(fixture("with-stoppable-serve-command"));

    const handle = await t.runLive("dev");
    await handle.waitForOutput(/FRONTEND_PID=/);
    const frontendPidText = await t.readProjectFile("frontend.pid");
    if (!frontendPidText) {
      throw new Error("Expected frontend.pid to be written by serveCommand");
    }
    const frontendPid = Number(frontendPidText);

    await handle.stop();

    expect(isProcessRunning(frontendPid)).toBe(false);
  });

  it("forwards caller Authorization and injects a service JWT to local functions", async () => {
    await t.givenLoggedInWithProject(fixture("with-service-auth-function"));

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/functions/hello`,
      {
        headers: {
          Authorization: "Bearer test-app-token",
          "X-App-Id": t.api.appId,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.authorization).toBe("Bearer test-app-token");
    expectServiceAuthorization(body.serviceAuthorization);

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("injects a synthetic service token for unauthenticated function calls", async () => {
    await t.givenLoggedInWithProject(fixture("with-service-auth-function"));

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    // Call the function with no Authorization header (unauthenticated caller,
    // e.g. a public subscribe form). The dev server must still inject a
    // Base44-Service-Authorization so that asServiceRole works inside the function.
    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/functions/hello`,
      {
        headers: {
          "X-App-Id": t.api.appId,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.authorization).toBeNull();
    expectServiceAuthorization(body.serviceAuthorization);

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("serves a function that exports a default handler and imports base44:runtime", async () => {
    await t.givenLoggedInWithProject(fixture("with-runtime-api-function"));
    t.givenEnv({ RUNTIME_API_TEST_SECRET: "from-the-environment" });

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/functions/hello`,
      {
        headers: {
          "X-App-Id": t.api.appId,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // The handler ran, so `export default` was picked up.
    expect(body.method).toBe("GET");
    // `secrets.get` reads the environment the dev server was started with.
    expect(body.secret).toBe("from-the-environment");
    // An unset secret reads as undefined rather than throwing, matching the
    // deployed signature `get(name: string): string | undefined`.
    expect(body.missing).toBe("undefined");
    // `waitUntil` returns the same promise so it composes, as in production.
    expect(body.composed).toBe("post-response work");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("serves both conventions under the Deno fallback runtime", async () => {
    // The compiled standalone binary cannot resolve miniflare and falls back
    // to the Deno subprocess; forcing it here keeps that path covered by the
    // npm-mode suite too.
    await t.givenLoggedInWithProject(fixture("with-runtime-api-function"));
    t.givenEnv({
      B44_DEV_FUNCTIONS_RUNTIME: "deno",
      RUNTIME_API_TEST_SECRET: "from-the-environment",
    });

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/functions/hello`,
      { headers: { "X-App-Id": t.api.appId } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.secret).toBe("from-the-environment");
    expect(body.missing).toBe("undefined");
    expect(body.composed).toBe("post-response work");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  // An app written entirely against the legacy Deno surface must keep working
  // untouched now that the wrapper also serves default exports.
  describe("existing Deno-syntax app", () => {
    const cases = [
      { fn: "classic", shape: "serve(handler)" },
      { fn: "serve-options", shape: "serve(options, handler)" },
      { fn: "serve-object", shape: "serve({ handler })" },
    ];

    for (const { fn, shape } of cases) {
      it(`serves a function using Deno.${shape}`, async () => {
        await t.givenLoggedInWithProject(fixture("legacy-deno-app"));
        t.givenEnv({ LEGACY_APP_SECRET: "legacy-env-value" });

        const handle = await t.runLive("dev");
        const devServerUrl = await waitForDevServer(handle);

        const response = await fetch(
          `${devServerUrl}/api/apps/${t.api.appId}/functions/${fn}`,
          { headers: { "X-App-Id": t.api.appId } },
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.shape).toBe(shape);

        const result = await handle.stop();
        t.expectResult(result).toSucceed();
      });
    }

    it("still reads Deno.env and receives the injected service token", async () => {
      await t.givenLoggedInWithProject(fixture("legacy-deno-app"));
      t.givenEnv({ LEGACY_APP_SECRET: "legacy-env-value" });

      const handle = await t.runLive("dev");
      const devServerUrl = await waitForDevServer(handle);

      const response = await fetch(
        `${devServerUrl}/api/apps/${t.api.appId}/functions/classic`,
        { headers: { "X-App-Id": t.api.appId } },
      );

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.secret).toBe("legacy-env-value");
      expect(body.serviceAuth).toBe(true);

      const result = await handle.stop();
      t.expectResult(result).toSucceed();
    });

    it("resolves relative imports between a function's own files", async () => {
      await t.givenLoggedInWithProject(fixture("legacy-deno-app"));

      const handle = await t.runLive("dev");
      const devServerUrl = await waitForDevServer(handle);

      const response = await fetch(
        `${devServerUrl}/api/apps/${t.api.appId}/functions/relative-imports`,
        { headers: { "X-App-Id": t.api.appId } },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        shape: "relative",
        version: "legacy-1",
        sibling: "sibling-ok",
      });

      const result = await handle.stop();
      t.expectResult(result).toSucceed();
    });
  });

  it("allows service-role JWTs to bypass denied entity create RLS", async () => {
    await t.givenLoggedInWithProject(fixture("with-private-note-entity"));

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);
    const url = `${devServerUrl}/api/apps/${t.api.appId}/entities/PrivateNote`;

    const unauthenticatedResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": t.api.appId,
      },
      body: JSON.stringify({ title: "Unauthenticated" }),
    });

    expect(unauthenticatedResponse.status).toBe(403);

    const serviceResponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: createServiceAuthorizationHeader(),
        "Content-Type": "application/json",
        "X-App-Id": t.api.appId,
      },
      body: JSON.stringify({ title: "Service role" }),
    });

    expect(serviceResponse.status).toBe(201);
    const body = (await serviceResponse.json()) as Record<string, unknown>;
    expect(body.title).toBe("Service role");
    expect(body.created_by).toBe(SERVICE_ROLE_EMAIL);

    const unauthenticatedListResponse = await fetch(url, {
      headers: {
        "X-App-Id": t.api.appId,
      },
    });
    expect(unauthenticatedListResponse.status).toBe(200);
    await expect(unauthenticatedListResponse.json()).resolves.toEqual([]);

    const serviceListResponse = await fetch(url, {
      headers: {
        Authorization: createServiceAuthorizationHeader(),
        "X-App-Id": t.api.appId,
      },
    });
    expect(serviceListResponse.status).toBe(200);
    const serviceListBody = (await serviceListResponse.json()) as Record<
      string,
      unknown
    >[];
    expect(serviceListBody).toHaveLength(1);
    expect(serviceListBody[0].title).toBe("Service role");

    const serviceDeleteResponse = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: createServiceAuthorizationHeader(),
        "Content-Type": "application/json",
        "X-App-Id": t.api.appId,
      },
      body: JSON.stringify({}),
    });
    expect(serviceDeleteResponse.status).toBe(200);
    await expect(serviceDeleteResponse.json()).resolves.toMatchObject({
      deleted: 1,
      success: true,
    });

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
