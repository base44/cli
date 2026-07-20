import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("exec command", () => {
  const t = setupCLITests();

  it("fails with helpful error when stdin is empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("exec");

    t.expectResult(result).toFail();
    expect(stripAnsi(result.stderr)).toBe(
      "Error: No input provided. Pipe a script to stdin.\n" +
        "  Hint: File:  cat ./script.ts | base44 exec\n" +
        '  Hint: Eval:  echo "const users = await base44.entities.User.list(); console.log(users)" | base44 exec',
    );
  });

  it("fails with error message when token exchange fails", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.api.mockError("get", `/api/apps/test-app-id/auth/token`, {
      status: 500,
      body: { detail: "Internal server error" },
    });
    t.givenStdin("console.log(1)");

    const result = await t.run("exec");

    t.expectResult(result).toFail();
    expect(stripAnsi(result.stderr)).toBe(
      "Error: Error exchanging platform token for app user token: Internal server error\n" +
        "  Hint: Check your network connection and try again",
    );
  });

  it("executes a piped script and captures its output", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.givenStdin('console.log("hello from exec")');

    const result = await t.run("exec");

    t.expectResult(result).toSucceed();
    expect(result.stdout).toContain("hello from exec");
  });

  it("executes with --app-id outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.givenStdin('console.log("hello from flag app")');

    const result = await t.run("exec", "--app-id", t.api.appId);

    t.expectResult(result).toSucceed();
    expect(result.stdout).toContain("hello from flag app");
  });

  it("executes with BASE44_APP_ID outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenEnv({ BASE44_APP_ID: t.api.appId });
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.givenStdin('console.log("hello from env app")');

    const result = await t.run("exec");

    t.expectResult(result).toSucceed();
    expect(result.stdout).toContain("hello from env app");
  });

  it("makes the pre-authenticated base44 SDK available as a global", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.givenStdin(
      'if (typeof base44 === "undefined") { Deno.exit(1); }\n' +
        'console.log("sdk-available");',
    );

    const result = await t.run("exec");

    t.expectResult(result).toSucceed();
    expect(result.stdout).toContain("sdk-available");
  });

  it("sends SDK requests to the app base URL with correct auth", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: t.api.baseUrl });

    let capturedAuth: string | undefined;
    t.api.mockRoute(
      "GET",
      `/api/apps/${t.api.appId}/entities/Task`,
      (req, res) => {
        capturedAuth = req.headers.authorization;
        res.json([{ id: "1", title: "Test Task" }]);
      },
    );

    t.givenStdin(
      "const tasks = await base44.entities.Task.list();\n" +
        "console.log(JSON.stringify(tasks));",
    );

    const result = await t.run("exec");

    t.expectResult(result).toSucceed();
    expect(result.stdout).toContain('{"id":"1","title":"Test Task"}');
    expect(capturedAuth).toBe("Bearer test-app-token");
  });

  it("forwards a non-zero script exit code", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.givenStdin("Deno.exit(42)");

    const result = await t.run("exec");

    expect(result.exitCode).toBe(42);
  });

  // ─── LOCAL DEV SERVER (--local) ──────────────────────────────

  it("targets the local dev server with a local user JWT when --local is set", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    // The TestAPIServer stands in for `base44 dev`; point --local at its port.
    // No mockAuthToken / mockSiteUrl: local mode must NOT call the remote
    // token/published-url endpoints (it would 404 here if it did).
    const port = new URL(t.api.baseUrl).port;

    let capturedAuth: string | undefined;
    t.api.mockRoute(
      "GET",
      `/api/apps/${t.api.appId}/entities/Task`,
      (req, res) => {
        capturedAuth = req.headers.authorization;
        res.json([{ id: "1", title: "Local Task" }]);
      },
    );

    t.givenStdin(
      "const tasks = await base44.entities.Task.list();\n" +
        "console.log(JSON.stringify(tasks));",
    );

    const result = await t.run("exec", "--local", "--port", port);

    t.expectResult(result).toSucceed();
    expect(result.stdout).toContain('{"id":"1","title":"Local Task"}');
    // Local auth is a JWT minted for the current user, not the remote app-user
    // token — decode the `sub` claim to prove it.
    expect(capturedAuth?.startsWith("Bearer ")).toBe(true);
    const jwtPayload = JSON.parse(
      Buffer.from(
        capturedAuth!.slice("Bearer ".length).split(".")[1],
        "base64url",
      ).toString(),
    );
    expect(jwtPayload.sub).toBe("test@example.com");
  });

  it("rejects --port without --local", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.givenStdin("console.log(1)");

    const result = await t.run("exec", "--port", "4400");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--port can only be used with --local");
  });
});
