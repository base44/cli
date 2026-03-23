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

  describe("--admin flag", () => {
    it("sends X-Bypass-RLS header when --admin is passed", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: t.api.baseUrl });

      let capturedHeaders: Record<string, string | undefined> = {};
      t.api.mockRoute(
        "GET",
        `/api/apps/${t.api.appId}/entities/Task`,
        (req, res) => {
          capturedHeaders = req.headers as Record<string, string | undefined>;
          res.json([]);
        },
      );

      t.givenStdin("await base44.entities.Task.list();");

      const result = await t.run("exec", "--admin");

      t.expectResult(result).toSucceed();
      expect(capturedHeaders["x-bypass-rls"]).toBe("true");
    });

    it("does NOT send X-Bypass-RLS header without --admin", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: t.api.baseUrl });

      let capturedHeaders: Record<string, string | undefined> = {};
      t.api.mockRoute(
        "GET",
        `/api/apps/${t.api.appId}/entities/Task`,
        (req, res) => {
          capturedHeaders = req.headers as Record<string, string | undefined>;
          res.json([]);
        },
      );

      t.givenStdin("await base44.entities.Task.list();");

      const result = await t.run("exec");

      t.expectResult(result).toSucceed();
      expect(capturedHeaders["x-bypass-rls"]).toBeUndefined();
    });
  });

  describe("--env flag", () => {
    it("sends X-Data-Env header with value 'dev' when --env dev is passed", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: t.api.baseUrl });

      let capturedHeaders: Record<string, string | undefined> = {};
      t.api.mockRoute(
        "GET",
        `/api/apps/${t.api.appId}/entities/Task`,
        (req, res) => {
          capturedHeaders = req.headers as Record<string, string | undefined>;
          res.json([]);
        },
      );

      t.givenStdin("await base44.entities.Task.list();");

      const result = await t.run("exec", "--env", "dev");

      t.expectResult(result).toSucceed();
      expect(capturedHeaders["x-data-env"]).toBe("dev");
    });

    it("sends X-Data-Env header with value 'prod' when --env prod is passed", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: t.api.baseUrl });

      let capturedHeaders: Record<string, string | undefined> = {};
      t.api.mockRoute(
        "GET",
        `/api/apps/${t.api.appId}/entities/Task`,
        (req, res) => {
          capturedHeaders = req.headers as Record<string, string | undefined>;
          res.json([]);
        },
      );

      t.givenStdin("await base44.entities.Task.list();");

      const result = await t.run("exec", "--env", "prod");

      t.expectResult(result).toSucceed();
      expect(capturedHeaders["x-data-env"]).toBe("prod");
    });

    it("does NOT send X-Data-Env header without --env", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: t.api.baseUrl });

      let capturedHeaders: Record<string, string | undefined> = {};
      t.api.mockRoute(
        "GET",
        `/api/apps/${t.api.appId}/entities/Task`,
        (req, res) => {
          capturedHeaders = req.headers as Record<string, string | undefined>;
          res.json([]);
        },
      );

      t.givenStdin("await base44.entities.Task.list();");

      const result = await t.run("exec");

      t.expectResult(result).toSucceed();
      expect(capturedHeaders["x-data-env"]).toBeUndefined();
    });
  });

  describe("--admin and --env combined", () => {
    it("sends both X-Bypass-RLS and X-Data-Env headers when both flags are passed", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: t.api.baseUrl });

      let capturedHeaders: Record<string, string | undefined> = {};
      t.api.mockRoute(
        "GET",
        `/api/apps/${t.api.appId}/entities/Task`,
        (req, res) => {
          capturedHeaders = req.headers as Record<string, string | undefined>;
          res.json([]);
        },
      );

      t.givenStdin("await base44.entities.Task.list();");

      const result = await t.run("exec", "--admin", "--env", "dev");

      t.expectResult(result).toSucceed();
      expect(capturedHeaders["x-bypass-rls"]).toBe("true");
      expect(capturedHeaders["x-data-env"]).toBe("dev");
    });
  });

  describe("env vars passed to Deno subprocess", () => {
    it("passes BASE44_ADMIN env var when --admin is used", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
      t.givenStdin('console.log("ADMIN=" + Deno.env.get("BASE44_ADMIN"));');

      const result = await t.run("exec", "--admin");

      t.expectResult(result).toSucceed();
      expect(result.stdout).toContain("ADMIN=true");
    });

    it("passes BASE44_DATA_ENV env var when --env is used", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockAuthToken("test-app-token");
      t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
      t.givenStdin('console.log("ENV=" + Deno.env.get("BASE44_DATA_ENV"));');

      const result = await t.run("exec", "--env", "dev");

      t.expectResult(result).toSucceed();
      expect(result.stdout).toContain("ENV=dev");
    });
  });
});
