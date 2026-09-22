import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { SERVICE_ROLE_EMAIL } from "@/cli/dev/dev-server/auth/tokens.js";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

interface EchoedRequest {
  url: string;
  headers: Record<string, string>;
}

describe("dev command fronting the app dev server", () => {
  const t = setupCLITests();

  const startDevServer = async () => {
    await t.givenLoggedInWithProject(fixture("with-app-server"));
    const handle = await t.runLive("dev");
    const url = await waitForDevServer(handle);
    return { handle, url };
  };

  it("forwards requests the platform does not own, carrying the SDK headers", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(`${url}/`, {
      headers: { Authorization: "Bearer visitor-token" },
    });

    expect(response.status).toBe(200);
    const { url: forwardedUrl, headers } =
      (await response.json()) as EchoedRequest;
    expect(forwardedUrl).toBe("/");
    expect(headers["base44-app-id"]).toBe(t.api.appId);
    expect(headers["base44-api-url"]).toBe(url);
    // The visitor's own token is what the app's server code acts as.
    expect(headers.authorization).toBe("Bearer visitor-token");
    const serviceToken = headers["base44-service-authorization"]?.replace(
      "Bearer ",
      "",
    );
    expect(jwt.decode(serviceToken ?? "")?.sub).toBe(SERVICE_ROLE_EMAIL);

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("drops the visitor's copies of the platform-owned headers", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(`${url}/`, {
      headers: {
        "Base44-App-Id": "spoofed-app",
        "Base44-Api-Url": "http://attacker.example",
        "Base44-Service-Authorization": "Bearer spoofed",
        "X-Data-Env": "prod",
      },
    });

    const { headers } = (await response.json()) as EchoedRequest;
    expect(headers["base44-app-id"]).toBe(t.api.appId);
    expect(headers["base44-api-url"]).toBe(url);
    expect(headers["base44-service-authorization"]).not.toBe("Bearer spoofed");
    expect(headers["x-data-env"]).toBeUndefined();

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("forwards the app's own routes under /api", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(`${url}/api/time`);

    const { url: forwardedUrl } = (await response.json()) as EchoedRequest;
    expect(forwardedUrl).toBe("/api/time");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("forwards the websocket upgrade the app's HMR client makes", async () => {
    const { handle, url } = await startDevServer();

    const socket = new WebSocket(`${url.replace("http", "ws")}/`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () =>
        reject(new Error("The upgrade never reached the app dev server")),
      );
    });
    socket.close();

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("leaves the entity-events socket to the local backend", async () => {
    const { handle, url } = await startDevServer();

    const socket = new WebSocket(
      `${url.replace("http", "ws")}/ws-user-apps/socket.io/?EIO=4&transport=websocket`,
    );
    const firstPacket = await new Promise<string>((resolve, reject) => {
      socket.addEventListener("message", (event) =>
        resolve(String(event.data)),
      );
      socket.addEventListener("error", () =>
        reject(new Error("The realtime socket did not connect")),
      );
    });
    socket.close();

    // Engine.IO's own open packet — the app dev server never saw this upgrade.
    expect(firstPacket.startsWith("0{")).toBe(true);

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("keeps /api/apps for the local backend", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(
      `${url}/api/apps/${t.api.appId}/functions/missing`,
      { headers: { "X-App-Id": t.api.appId } },
    );

    const body = (await response.json()) as Partial<EchoedRequest>;
    expect(body.headers).toBeUndefined();

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
