import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import express from "express";
import jwt from "jsonwebtoken";
import { outdent } from "outdent";
import { describe, expect, it } from "vitest";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import {
  createServiceAuthorizationHeader,
  SERVICE_ROLE_EMAIL,
} from "@/cli/dev/dev-server/auth/tokens.js";
import type { FunctionManager } from "@/cli/dev/dev-server/function-manager.js";
import { createFunctionRouter } from "@/cli/dev/dev-server/routes/functions.js";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

const expectServiceAuthorization = (value: unknown) => {
  expect(value).toEqual(expect.stringMatching(/^Bearer \S+$/));
  const token = (value as string).replace("Bearer ", "");
  expect(jwt.decode(token)?.sub).toBe(SERVICE_ROLE_EMAIL);
};

const noopLogger: DevLogger = {
  error: () => {},
  log: () => {},
  warn: () => {},
};

const listen = async (server: Server): Promise<number> => {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not receive a TCP port"));
        return;
      }

      resolve(address.port);
    });
  });
};

const close = async (server: Server): Promise<void> => {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const startHeaderEchoFunctionProxy = async () => {
  const upstream = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        appId: req.headers["base44-app-id"] ?? null,
        authorization: req.headers.authorization ?? null,
        serviceAuthorization:
          req.headers["base44-service-authorization"] ?? null,
      }),
    );
  });
  const upstreamPort = await listen(upstream);

  const manager = {
    ensureRunning: async () => upstreamPort,
  } as unknown as FunctionManager;

  const app = express();
  app.use(
    "/api/apps/:appId/functions",
    createFunctionRouter(manager, noopLogger),
  );

  const proxy = createServer(app);
  const proxyPort = await listen(proxy);

  return {
    close: async () => {
      await close(proxy);
      await close(upstream);
    },
    url: `http://127.0.0.1:${proxyPort}`,
  };
};

describe("dev command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("dev");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("starts dev server successfully", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    const result = await handle.stop();

    t.expectResult(result).toSucceed();
  });

  it("forwards caller Authorization and injects a service JWT to local functions", async () => {
    const proxy = await startHeaderEchoFunctionProxy();

    try {
      const response = await fetch(
        `${proxy.url}/api/apps/${t.api.appId}/functions/hello`,
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
      expect(body.appId).toBe(t.api.appId);
      expectServiceAuthorization(body.serviceAuthorization);
    } finally {
      await proxy.close();
    }
  });

  it("injects a synthetic service token for unauthenticated function calls", async () => {
    const proxy = await startHeaderEchoFunctionProxy();

    try {
      // Call the function with no Authorization header (unauthenticated caller,
      // e.g. a public subscribe form). The dev server must still inject a
      // Base44-Service-Authorization so that asServiceRole works inside the function.
      const response = await fetch(
        `${proxy.url}/api/apps/${t.api.appId}/functions/hello`,
        {
          headers: {
            "X-App-Id": t.api.appId,
          },
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.authorization).toBeNull();
      expect(body.appId).toBe(t.api.appId);
      expectServiceAuthorization(body.serviceAuthorization);
    } finally {
      await proxy.close();
    }
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
