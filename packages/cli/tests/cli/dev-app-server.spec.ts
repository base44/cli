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

  it("relays the app's HMR socket to its dev server, carrying the SDK headers", async () => {
    const { handle, url } = await startDevServer();

    const socket = new WebSocket(`${url.replace("http", "ws")}/__hmr`);
    const first = await new Promise<string>((resolve, reject) => {
      socket.addEventListener("message", (event) =>
        resolve(String(event.data)),
      );
      socket.addEventListener("error", () =>
        reject(new Error("The upgrade never reached the app dev server")),
      );
    });
    socket.close();

    // The dev server's own frame, so the socket reached it rather than only
    // being accepted at the front door.
    const { url: forwardedUrl, headers } = JSON.parse(first) as EchoedRequest;
    expect(forwardedUrl).toBe("/__hmr");
    expect(headers["base44-app-id"]).toBe(t.api.appId);

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

  it("keeps the SDK's /api/app-logs off the app dev server", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(
      `${url}/api/app-logs/${t.api.appId}/log-user-in-app/Home`,
      { method: "POST" },
    );

    // The app dev server would echo the request back.
    expect(await response.text()).not.toContain("log-user-in-app");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});

describe("dev command in front of a private app", () => {
  const t = setupCLITests();
  const email = "dev@example.com";

  const startDevServer = async (fixtureName = "with-private-app-server") => {
    await t.givenLoggedInWithProject(fixture(fixtureName), {
      email,
      name: "Dev",
    });
    const handle = await t.runLive("dev");
    const url = await waitForDevServer(handle);
    return { handle, url };
  };

  const page = { Accept: "text/html" };

  it("sends a page load without a session to the CLI's sign-in page", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(`${url}/notes`, {
      headers: page,
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const login = new URL(response.headers.get("location") ?? "");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("from_url")).toBe(`${url}/notes`);

    const loginPage = await fetch(login, { headers: page });
    expect(await loginPage.text()).toContain(`Continue as ${email}`);

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("signs the developer in, hands the app a token, and sends it with later requests", async () => {
    const { handle, url } = await startDevServer();

    const signIn = await fetch(`${url}/login`, {
      method: "POST",
      body: new URLSearchParams({ from_url: `${url}/notes` }),
      redirect: "manual",
    });

    expect(signIn.status).toBe(303);
    const back = new URL(signIn.headers.get("location") ?? "");
    expect(back.pathname).toBe("/notes");
    const token = back.searchParams.get("access_token") ?? "";
    expect(jwt.decode(token)?.sub).toBe(email);
    const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^base44_dev_session=/);

    const response = await fetch(`${url}/notes`, {
      headers: { ...page, Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const { headers } = (await response.json()) as EchoedRequest;
    expect(headers.authorization).toBe(`Bearer ${token}`);

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("ends the session on the SDK's logout", async () => {
    const { handle, url } = await startDevServer();

    const response = await fetch(
      `${url}/api/apps/auth/logout?from_url=${encodeURIComponent(`${url}/`)}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${url}/`);
    expect(response.headers.get("set-cookie")).toMatch(
      /^base44_dev_session=;.*Max-Age=0/,
    );

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("leaves sign-in to a public app", async () => {
    const { handle, url } = await startDevServer("with-app-server");

    const response = await fetch(`${url}/login`, {
      headers: page,
      redirect: "manual",
    });

    expect(response.status).toBe(200);
    const { url: forwardedUrl } = (await response.json()) as EchoedRequest;
    expect(forwardedUrl).toBe("/login");

    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });
});
