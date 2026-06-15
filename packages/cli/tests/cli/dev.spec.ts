import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { outdent } from "outdent";
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

  it("does not write .env.local by default", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    await handle.stop();

    const content = await t.readProjectFile(".env.local");
    expect(content).toBeNull();
  });

  it("writes .env.local with app ID and dev server URL when --write-env is passed", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev", "--write-env");
    await waitForDevServer(handle);
    await handle.stop();

    const content = await t.readProjectFile(".env.local");
    expect(content).toContain(`VITE_BASE44_APP_ID=${t.api.appId}`);
    expect(content).toContain("VITE_BASE44_APP_BASE_URL=http://localhost:");
  });

  const writeConfigWithServeCommand = async (serveCommand: string) => {
    const configPath = join(
      t.getTempDir(),
      "project",
      "base44",
      "config.jsonc",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        name: "Full Project",
        site: { outputDirectory: "site-output", serveCommand },
      }),
    );
  };

  it("runs the frontend serveCommand with injected Base44 env vars", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    await writeConfigWithServeCommand(
      `node -e "console.log('SERVE_APP=' + process.env.VITE_BASE44_APP_ID + ' URL=' + process.env.VITE_BASE44_APP_BASE_URL); setInterval(() => {}, 1000)"`,
    );

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    await handle.waitForOutput(/SERVE_APP=/);
    await handle.stop();

    const output = handle.stdout.join("");
    expect(output).toContain(`SERVE_APP=${t.api.appId}`);
    expect(output).toContain("URL=http://localhost:");
    expect(output).toContain("[frontend]");
  });

  it("stays backend-only when --no-serve is passed", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    await writeConfigWithServeCommand(
      `node -e "console.log('SERVE_APP=' + process.env.VITE_BASE44_APP_ID); setInterval(() => {}, 1000)"`,
    );

    const handle = await t.runLive("dev", "--no-serve");
    await waitForDevServer(handle);
    await handle.stop();

    expect(handle.stdout.join("")).not.toContain("SERVE_APP=");
  });

  it("tears the dev server down when the frontend exits", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    // Frontend prints, then exits non-zero shortly after startup.
    await writeConfigWithServeCommand(
      `node -e "console.log('frontend up'); setTimeout(() => process.exit(1), 300)"`,
    );

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    const result = await handle.waitForExit();

    expect(result.exitCode).not.toBe(0);
  });

  it("forwards caller Authorization and injects a service JWT to local functions", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    await writeFile(
      join(
        t.getTempDir(),
        "project",
        "base44",
        "functions",
        "hello",
        "index.ts",
      ),
      outdent`
        Deno.serve((req: Request) => {
          return new Response(JSON.stringify({
            authorization: req.headers.get("authorization"),
            serviceAuthorization: req.headers.get("base44-service-authorization"),
          }), {
            headers: { "Content-Type": "application/json" },
          });
        });
      `,
    );

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
    await t.givenLoggedInWithProject(fixture("full-project"));

    await writeFile(
      join(
        t.getTempDir(),
        "project",
        "base44",
        "functions",
        "hello",
        "index.ts",
      ),
      outdent`
        Deno.serve((req: Request) => {
          return new Response(JSON.stringify({
            authorization: req.headers.get("authorization"),
            serviceAuthorization: req.headers.get("base44-service-authorization"),
          }), {
            headers: { "Content-Type": "application/json" },
          });
        });
      `,
    );

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

  it("allows service-role JWTs to bypass denied entity create RLS", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const entitiesDir = join(t.getTempDir(), "project", "base44", "entities");
    await mkdir(entitiesDir, { recursive: true });
    await writeFile(
      join(entitiesDir, "private-note.jsonc"),
      outdent`
        {
          "name": "PrivateNote",
          "type": "object",
          "properties": {
            "title": { "type": "string" }
          },
          "rls": {
            "create": false,
            "read": false
          }
        }
      `,
    );

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
