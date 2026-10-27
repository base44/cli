import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_SESSION_ID,
  CODEX_THREAD_ID,
  plantClaudeSession,
  plantCodexSessions,
} from "../fixtures/sessions/plant.js";
import { setupCLITests } from "./testkit/index.js";

const ROUTE = "/api/apps/test-app-id/imported/session-imports";

interface Captured {
  body: Record<string, unknown>;
  turns: { role: string; text: string }[];
}

describe("session import command", () => {
  const t = setupCLITests();

  async function givenSessions(): Promise<void> {
    const repo = join(t.getTempDir(), "repo");
    await mkdir(repo, { recursive: true });
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await plantClaudeSession(t.getTempDir(), repo);
    await plantCodexSessions(t.getTempDir(), repo);
  }

  function mockImport(status = 201): Captured[] {
    const captured: Captured[] = [];
    t.api.mockRoute("POST", ROUTE, (req, res) => {
      const body = req.body as Record<string, unknown>;
      const inflated = gunzipSync(
        Buffer.from(String(body.turns_gzip_base64), "base64"),
      );
      captured.push({ body, turns: JSON.parse(inflated.toString("utf8")) });
      res
        .status(status)
        .json({ branch_id: "branch-1", branch_name: "checkout-retry-bug" });
    });
    return captured;
  }

  it("uploads a Claude Code session as gzipped base64 and prints the branch link", async () => {
    await givenSessions();
    const captured = mockImport();

    const result = await t.run(
      "session",
      "import",
      "--session",
      CLAUDE_SESSION_ID,
      "--yes",
      "--app-id",
      "test-app-id",
      "--json",
    );

    t.expectResult(result).toSucceed();
    expect(Object.keys(captured[0]?.body ?? {}).sort()).toEqual([
      "source",
      "source_session_id",
      "title",
      "turns_gzip_base64",
    ]);
    expect(captured[0]?.body).toMatchObject({
      source: "claude_code",
      source_session_id: CLAUDE_SESSION_ID,
      title: "Checkout retry bug",
    });
    expect(captured[0]?.turns.map((turn) => turn.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(captured[0]?.turns[1]?.text).toContain("idempotency key");
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      branchId: "branch-1",
      branchName: "checkout-retry-bug",
      created: true,
      source: "claude_code",
      sessionId: CLAUDE_SESSION_ID,
      messageCount: 4,
    });
    expect(output.url).toMatch(
      /\/apps\/test-app-id\/editor\/workspace\/code\?branch=checkout-retry-bug$/,
    );
  });

  it("uploads a Codex session under its own source", async () => {
    await givenSessions();
    const captured = mockImport();

    const result = await t.run(
      "session",
      "import",
      "--session",
      CODEX_THREAD_ID,
      "--yes",
      "--app-id",
      "test-app-id",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("checkout-retry-bug");
    expect(captured[0]?.body).toMatchObject({
      source: "codex",
      source_session_id: CODEX_THREAD_ID,
      title: "Export dry run",
    });
  });

  it("reports a replay as already imported", async () => {
    await givenSessions();
    mockImport(200);

    const result = await t.run(
      "session",
      "import",
      "--session",
      CLAUDE_SESSION_ID,
      "--yes",
      "--app-id",
      "test-app-id",
      "--json",
    );

    expect(JSON.parse(result.stdout)).toMatchObject({ created: false });
  });

  it("asks for --yes before uploading in non-interactive mode", async () => {
    await givenSessions();
    const captured = mockImport();

    const result = await t.run(
      "session",
      "import",
      "--session",
      CLAUDE_SESSION_ID,
      "--app-id",
      "test-app-id",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--yes is required");
    expect(captured).toHaveLength(0);
  });

  it("asks for --session when it cannot show a picker", async () => {
    await givenSessions();

    const result = await t.run(
      "session",
      "import",
      "--yes",
      "--app-id",
      "test-app-id",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--session <id> is required");
  });

  it("fails clearly for a session id that is not on this machine", async () => {
    await givenSessions();
    const captured = mockImport();

    const result = await t.run(
      "session",
      "import",
      "--session",
      "00000000-0000-4000-8000-000000000000",
      "--yes",
      "--app-id",
      "test-app-id",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("was found on this machine");
    expect(captured).toHaveLength(0);
  });

  it("explains a 404 with a hint", async () => {
    await givenSessions();
    t.api.mockRoute("POST", ROUTE, (_req, res) =>
      res.status(404).json({ detail: "Not found" }),
    );

    const result = await t.run(
      "session",
      "import",
      "--session",
      CLAUDE_SESSION_ID,
      "--yes",
      "--app-id",
      "test-app-id",
      "--json",
    );

    t.expectResult(result).toFail();
    const envelope = JSON.parse(result.stdout);
    expect(envelope.statusCode).toBe(404);
    expect(JSON.stringify(envelope.hints)).toContain(
      "imported from a repository",
    );
  });

  it("stays out of --help", async () => {
    const result = await t.run("--help");

    expect(result.stdout).not.toContain("session");
  });
});
