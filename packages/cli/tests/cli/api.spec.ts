import { access, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

interface CapturedRequest {
  url: string;
  authorization?: string;
  contentType?: string;
  body: string;
}

function capture(req: Request): CapturedRequest {
  const body = Buffer.isBuffer(req.body)
    ? req.body.toString("utf-8")
    : req.body && Object.keys(req.body).length > 0
      ? JSON.stringify(req.body)
      : "";
  return {
    url: req.originalUrl,
    authorization: req.headers.authorization,
    contentType: req.headers["content-type"],
    body,
  };
}

describe("api command", () => {
  const t = setupCLITests();
  let specText: string;
  let specFetches: number;
  let sent: CapturedRequest[];

  const cachePath = () => {
    const server = new URL(t.api.baseUrl).host.replace(":", "_");
    return join(t.getTempDir(), ".base44", "cache", server, "openapi.json");
  };

  beforeEach(async () => {
    specText = await readFile(fixture("api-spec/openapi.json"), "utf-8");
    specFetches = 0;
    sent = [];
    t.api.mockRoute("GET", "/api/openapi.json", (_req, res) => {
      specFetches++;
      res.type("application/json").send(specText);
    });
  });

  describe("search", () => {
    it("returns the best matches as JSON", async () => {
      const result = await t.run("api", "search", "workflow", "runs");

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)[0]).toEqual({
        endpoint: "GET /api/apps/{app_id}/workflows/runs",
        summary: "List workflow runs for an app",
      });
    });

    it("returns only read-only operations with --read-only", async () => {
      const result = await t.run("api", "search", "workflow", "--read-only");

      t.expectResult(result).toSucceed();
      const results = JSON.parse(result.stdout);
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.every((r: { endpoint: string }) =>
          r.endpoint.startsWith("GET "),
        ),
      ).toBe(true);
    });

    it("rejects a malformed --limit", async () => {
      const result = await t.run("api", "search", "apps", "--limit", "0");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("--limit must be a positive integer");
    });
  });

  describe("spec cache", () => {
    it("saves the spec as is and reuses it within the hour", async () => {
      await t.run("api", "search", "apps");
      const second = await t.run("api", "search", "apps");

      t.expectResult(second).toSucceed();
      expect(specFetches).toBe(1);
      expect(await readFile(cachePath(), "utf-8")).toBe(specText);
    });

    it("fetches again with --refresh", async () => {
      await t.run("api", "search", "apps");
      await t.run("api", "search", "apps", "--refresh");

      expect(specFetches).toBe(2);
    });

    it("fetches again once the cached copy is over an hour old", async () => {
      await t.run("api", "search", "apps");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(cachePath(), twoHoursAgo, twoHoursAgo);

      await t.run("api", "search", "apps");

      expect(specFetches).toBe(2);
    });

    it("downloads again when the cached copy is unreadable", async () => {
      await t.run("api", "search", "apps");
      await writeFile(cachePath(), '{"truncated');

      const result = await t.run("api", "search", "apps");

      t.expectResult(result).toSucceed();
      expect(specFetches).toBe(2);
      expect(await readFile(cachePath(), "utf-8")).toBe(specText);
      expect(await readdir(dirname(cachePath()))).toEqual(["openapi.json"]);
    });

    it("does not cache a spec it cannot parse", async () => {
      specText = '{"not":"a spec"}';
      const result = await t.run("api", "search", "apps");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("Invalid API spec");
      await expect(access(cachePath())).rejects.toThrow();
    });
  });

  describe("catalog", () => {
    it("lists every area", async () => {
      const result = await t.run("api", "catalog");

      t.expectResult(result).toSucceed();
      const index = JSON.parse(result.stdout);
      expect(index.total).toBe(11);
      expect(index.areas.map((a: { area: string }) => a.area)).toContain(
        "workflows",
      );
    });

    it("lists one area's operations", async () => {
      const result = await t.run("api", "catalog", "secrets");

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({
        area: "secrets",
        operations: [
          {
            endpoint: "GET /api/apps/{app_id}/secrets",
            summary: "List secrets",
          },
          {
            endpoint: "POST /api/apps/{app_id}/secrets",
            summary: "Set secret",
          },
        ],
        total: 2,
        truncated: false,
      });
    });

    it("lists an area with no read-only operations as empty", async () => {
      const result = await t.run("api", "catalog", "deploy", "--read-only");

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({
        area: "deploy",
        operations: [],
        total: 0,
        truncated: false,
      });
    });

    it("lists only read-only operations with --read-only", async () => {
      const result = await t.run("api", "catalog", "secrets", "--read-only");

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toMatchObject({
        operations: [{ endpoint: "GET /api/apps/{app_id}/secrets" }],
        total: 1,
      });
    });

    it("fails on an unknown area and lists the real ones", async () => {
      const result = await t.run("api", "catalog", "nope");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("Unknown API area: nope");
      t.expectResult(result).toContain("workflows");
    });
  });

  describe("grep", () => {
    it("searches one area with --area", async () => {
      const result = await t.run(
        "api",
        "grep",
        "workflow",
        "--area",
        "workflows",
      );

      t.expectResult(result).toSucceed();
      const hits = JSON.parse(result.stdout);
      expect(hits).toHaveLength(4);
      expect(
        hits.every((h: { endpoint: string }) =>
          h.endpoint.includes("/workflows"),
        ),
      ).toBe(true);
    });

    it("searches only read-only operations with --read-only", async () => {
      const result = await t.run("api", "grep", "workflow", "--read-only");

      t.expectResult(result).toSucceed();
      expect(
        JSON.parse(result.stdout).map((h: { endpoint: string }) => h.endpoint),
      ).toEqual([
        "GET /api/apps/{app_id}/workflows/runs",
        "GET /api/apps/{app_id}/workflows/{workflow_id}",
      ]);
    });

    it("fails on an unknown --area", async () => {
      const result = await t.run("api", "grep", "x", "--area", "nope");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("Unknown API area: nope");
    });

    it("returns regex matches grouped by operation or schema", async () => {
      const result = await t.run("api", "grep", "trigger_\\w+");

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual([
        {
          schema: "WorkflowCreate",
          matches: [expect.stringContaining("trigger_status")],
        },
      ]);
    });

    it("rejects an invalid regular expression", async () => {
      const result = await t.run("api", "grep", "(unclosed");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("Invalid regular expression");
    });
  });

  describe("fetch", () => {
    beforeEach(async () => {
      await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
      const record = (status: number) => (req: Request, res: Response) => {
        sent.push(capture(req));
        res.status(status).json({ ok: true, echoed: sent.at(-1)?.body });
      };
      t.api
        .mockRoute("GET", "/api/apps/:appId/workflows/runs", record(200))
        .mockRoute("POST", "/api/apps/:appId/secrets", record(200))
        .mockRoute("DELETE", "/api/apps/:appId/workflows/:id", record(200))
        .mockRoute("GET", "/api/brand-new-route", record(200))
        .mockRoute("DELETE", "/api/apps/:appId/secrets", (_req, res) => {
          res.status(204).end();
        })
        .mockRoute("GET", "/api/apps/:appId/report.csv", (_req, res) => {
          res.type("text/csv").send("a,b\n1,2");
        })
        .mockRoute("GET", "/api/apps/:appId/export", (_req, res) => {
          res
            .type("application/zip")
            .send(Buffer.from([0x50, 0x4b, 0xff, 0x00]));
        })
        .mockRoute("GET", "/api/apps/:appId/forbidden", (_req, res) => {
          res.status(403).json({ detail: "You cannot open this app" });
        });
    });

    it("sends the path and query string as is, with the login attached", async () => {
      const result = await t.run(
        "api",
        "fetch",
        "get",
        "/api/apps/68a1/workflows/runs?status=failed&since=2026-10-10",
      );

      t.expectResult(result).toSucceed();
      expect(sent).toEqual([
        expect.objectContaining({
          url: "/api/apps/68a1/workflows/runs?status=failed&since=2026-10-10",
          authorization: "Bearer test-access-token",
        }),
      ]);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
      expect(specFetches).toBe(0);
    });

    it("prints the response compact when piped", async () => {
      const result = await t.run("api", "fetch", "GET", "/api/brand-new-route");

      t.expectResult(result).toSucceed();
      expect(result.stdout).toBe('{"ok":true,"echoed":""}');
    });

    it("sends a --body JSON flag", async () => {
      const result = await t.run(
        "api",
        "fetch",
        "POST",
        "/api/apps/68a1/secrets",
        "--body",
        '{"name":"KEY","value":"v"}',
      );

      t.expectResult(result).toSucceed();
      expect(sent[0]).toMatchObject({
        contentType: "application/json",
        body: '{"name":"KEY","value":"v"}',
      });
    });

    it("sends a --body @file", async () => {
      const file = join(t.getTempDir(), "body.json");
      await writeFile(file, '{"from":"file"}');

      const result = await t.run(
        "api",
        "fetch",
        "POST",
        "/api/apps/68a1/secrets",
        "--body",
        `@${file}`,
      );

      t.expectResult(result).toSucceed();
      expect(sent[0]?.body).toBe('{"from":"file"}');
    });

    it("sends stdin with --body @-", async () => {
      t.givenStdin('{"from":"stdin"}');

      const result = await t.run(
        "api",
        "fetch",
        "POST",
        "/api/apps/68a1/secrets",
        "--body",
        "@-",
      );

      t.expectResult(result).toSucceed();
      expect(sent[0]?.body).toBe('{"from":"stdin"}');
    });

    it("reads stdin only with --body @-", async () => {
      t.givenStdin('{"from":"stdin"}');

      const result = await t.run(
        "api",
        "fetch",
        "POST",
        "/api/apps/68a1/secrets",
      );

      t.expectResult(result).toSucceed();
      expect(sent[0]?.body).toBe("");
    });

    it("ignores piped stdin on a GET", async () => {
      t.givenStdin('{"ignored":true}');

      const result = await t.run("api", "fetch", "GET", "/api/brand-new-route");

      t.expectResult(result).toSucceed();
      expect(sent[0]?.body).toBe("");
    });

    it("accepts a path without the leading slash", async () => {
      const result = await t.run("api", "fetch", "GET", "api/brand-new-route");

      t.expectResult(result).toSucceed();
      expect(sent[0]?.url).toBe("/api/brand-new-route");
    });

    it("prints the status when the response has no body", async () => {
      const result = await t.run(
        "api",
        "fetch",
        "DELETE",
        "/api/apps/68a1/secrets",
      );

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({ status: 204 });
    });

    it("describes a binary response instead of printing it", async () => {
      const result = await t.run(
        "api",
        "fetch",
        "GET",
        "/api/apps/68a1/export",
      );

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({
        status: 200,
        contentType: "application/zip",
        bytes: 4,
        note: "Binary body not printed; add --output <file> to save it.",
      });
    });

    it("wraps a text body in JSON under --json", async () => {
      const result = await t.run(
        "--json",
        "api",
        "fetch",
        "GET",
        "/api/apps/68a1/report.csv",
      );

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: "a,b\n1,2",
      });
    });

    it("prints a text body as is without --json", async () => {
      const result = await t.run(
        "api",
        "fetch",
        "GET",
        "/api/apps/68a1/report.csv",
      );

      t.expectResult(result).toSucceed();
      expect(result.stdout).toBe("a,b\n1,2");
    });

    it("saves the response as is with --output", async () => {
      const file = join(t.getTempDir(), "export.zip");

      const result = await t.run(
        "api",
        "fetch",
        "GET",
        "/api/apps/68a1/export",
        "--output",
        file,
      );

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({
        status: 200,
        contentType: "application/zip",
        bytes: 4,
        output: file,
      });
      expect([...(await readFile(file))]).toEqual([0x50, 0x4b, 0xff, 0x00]);
    });

    it("reports the server's error", async () => {
      const result = await t.run(
        "api",
        "fetch",
        "GET",
        "/api/apps/68a1/forbidden",
      );

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("You cannot open this app");
      t.expectResult(result).toContain(
        'Response body: {"detail":"You cannot open this app"}',
      );
    });

    it("puts the status and raw body in the --json error", async () => {
      const result = await t.run(
        "--json",
        "api",
        "fetch",
        "GET",
        "/api/apps/68a1/forbidden",
      );

      t.expectResult(result).toFail();
      expect(JSON.parse(result.stdout)).toMatchObject({
        statusCode: 403,
        details: ['Response body: {"detail":"You cannot open this app"}'],
      });
    });

    it("sends a path the spec does not know", async () => {
      const result = await t.run("api", "fetch", "GET", "/api/brand-new-route");

      t.expectResult(result).toSucceed();
      expect(sent).toHaveLength(1);
    });

    describe("--read-only", () => {
      it("refuses an unsafe operation without sending it", async () => {
        const result = await t.run(
          "api",
          "fetch",
          "DELETE",
          "/api/apps/68a1/workflows/wf_9",
          "--read-only",
        );

        t.expectResult(result).toFail();
        t.expectResult(result).toContain(
          "DELETE /api/apps/{app_id}/workflows/{workflow_id} is not a read-only operation",
        );
        expect(sent).toEqual([]);
      });

      it("refuses a path the spec does not know without sending it", async () => {
        const result = await t.run(
          "api",
          "fetch",
          "GET",
          "/api/brand-new-route",
          "--read-only",
        );

        t.expectResult(result).toFail();
        t.expectResult(result).toContain(
          "No operation in the API spec matches",
        );
        t.expectResult(result).toContain(
          "base44 api fetch GET /api/brand-new-route --read-only --refresh",
        );
        expect(sent).toEqual([]);
      });

      it("sends a read-only operation", async () => {
        const result = await t.run(
          "api",
          "fetch",
          "GET",
          "/api/apps/68a1/workflows/runs?status=failed",
          "--read-only",
        );

        t.expectResult(result).toSucceed();
        expect(sent).toHaveLength(1);
      });
    });

    describe("--help", () => {
      it("prints the matched operation's contract without sending", async () => {
        const result = await t.run(
          "api",
          "fetch",
          "POST",
          "/api/apps/68a1/workflows",
          "--help",
        );

        t.expectResult(result).toSucceed();
        const contract = JSON.parse(result.stdout);
        expect(contract).toMatchObject({
          endpoint: "POST /api/apps/{app_id}/workflows",
          parameters: [expect.objectContaining({ name: "app_id" })],
          requestBodySchema: {
            properties: { trigger_status: { type: "string" } },
          },
        });
        expect(contract).not.toHaveProperty("readOnly");
        expect(sent).toEqual([]);
      });

      it("prints the command help without a path", async () => {
        const result = await t.run("api", "fetch", "--help");

        t.expectResult(result).toSucceed();
        t.expectResult(result).toContain("Usage: base44 api fetch");
      });

      it("wraps the command help in JSON under --json", async () => {
        const result = await t.run("--json", "api", "fetch", "--help");

        t.expectResult(result).toSucceed();
        expect(JSON.parse(result.stdout).usage).toContain(
          "Usage: base44 api fetch",
        );
      });
    });
  });
});

describe("api fetch when logged out", () => {
  const t = setupCLITests();

  it("prints a contract without a login", async () => {
    const specText = await readFile(fixture("api-spec/openapi.json"), "utf-8");
    t.api.mockRoute("GET", "/api/openapi.json", (_req, res) => {
      res.type("application/json").send(specText);
    });

    const result = await t.run("api", "fetch", "GET", "/api/apps", "--help");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toMatchObject({
      endpoint: "GET /api/apps",
    });
  });
});
