import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { dir } from "tmp-promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSessions,
  readSessionById,
  type SessionRoots,
} from "@/core/session-import/sessions.js";
import {
  encodeTurns,
  MAX_CHARS_PER_TURN,
  MAX_TOTAL_CHARS,
  MAX_TURNS,
  prepareTranscript,
  type SessionTurn,
} from "@/core/session-import/transcript.js";
import {
  CLAUDE_SESSION_ID,
  CODEX_THREAD_ID,
  plantClaudeSession,
  plantCodexSessions,
} from "../fixtures/sessions/plant.js";

describe("session import transcripts", () => {
  let home: string;
  let cleanup: () => Promise<void>;
  let repo: string;
  let roots: SessionRoots;

  beforeEach(async () => {
    const tmp = await dir({ unsafeCleanup: true });
    home = tmp.path;
    cleanup = tmp.cleanup;
    repo = join(home, "work", "repo");
    await mkdir(repo, { recursive: true });
    roots = {
      claudeProjectsDir: join(home, ".claude", "projects"),
      codexHome: join(home, ".codex"),
    };
  });

  afterEach(() => cleanup());

  describe("Claude Code", () => {
    it("keeps only what the user and assistant said, under the session's own title", async () => {
      await plantClaudeSession(home, repo);

      const found = await readSessionById(roots, CLAUDE_SESSION_ID);

      expect(found?.session).toMatchObject({
        source: "claude_code",
        id: CLAUDE_SESSION_ID,
        title: "Checkout retry bug",
        cwd: repo,
      });
      expect(found?.turns).toEqual([
        { role: "user", text: "/review the checkout flow" },
        {
          role: "user",
          text: "Why does checkout double-charge when the retry button is pressed twice? Use codeword PELICAN-7731 in your notes.",
        },
        { role: "assistant", text: "I'll read the retry handler first." },
        {
          role: "assistant",
          text: "The handler never checks the idempotency key, so a second press creates a second charge.",
        },
        { role: "user", text: "Fix it and keep the diff small." },
        {
          role: "assistant",
          text: "Done: the handler now rejects a repeated idempotency key.",
        },
      ]);
    });
  });

  describe("Codex", () => {
    it("skips developer and injected items and names the thread from the index", async () => {
      await plantCodexSessions(home, repo);

      const found = await readSessionById(roots, CODEX_THREAD_ID);

      expect(found?.session).toMatchObject({
        source: "codex",
        id: CODEX_THREAD_ID,
        title: "Export dry run",
      });
      expect(found?.turns.map((turn) => turn.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(found?.turns[0]?.text).toContain("KINGFISHER-2208");
    });

    it("does not list headless exec runs or subagent threads", async () => {
      await plantCodexSessions(home, repo);

      const sessions = await listSessions(roots, { limit: 10 });

      expect(sessions.map((session) => session.id)).toEqual([CODEX_THREAD_ID]);
    });
  });

  describe("listing", () => {
    it("lists newest first and only sessions started inside the repository", async () => {
      const elsewhere = join(home, "work", "other");
      await mkdir(elsewhere, { recursive: true });
      await plantClaudeSession(home, repo, {
        mtime: new Date("2026-10-18T12:00:00Z"),
      });
      await plantClaudeSession(home, elsewhere, {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        mtime: new Date("2026-10-18T13:00:00Z"),
      });
      await plantCodexSessions(home, join(repo, "packages", "app"), {
        mtime: new Date("2026-10-18T14:00:00Z"),
      });

      const inRepo = await listSessions(roots, { within: repo, limit: 10 });
      const everywhere = await listSessions(roots, { limit: 10 });

      expect(inRepo.map((session) => session.id)).toEqual([
        CODEX_THREAD_ID,
        CLAUDE_SESSION_ID,
      ]);
      expect(everywhere.map((session) => session.id)).toEqual([
        CODEX_THREAD_ID,
        "aaaaaaaa-0000-4000-8000-000000000001",
        CLAUDE_SESSION_ID,
      ]);
    });

    it("stops at the limit", async () => {
      await plantClaudeSession(home, repo);
      await plantCodexSessions(home, repo);

      expect(await listSessions(roots, { limit: 1 })).toHaveLength(1);
    });

    it("finds nothing when no agent has run on the machine", async () => {
      expect(await listSessions(roots, { limit: 10 })).toEqual([]);
      expect(await readSessionById(roots, CLAUDE_SESSION_ID)).toBeUndefined();
    });
  });

  describe("prepareTranscript", () => {
    const user = (text: string): SessionTurn => ({ role: "user", text });
    const assistant = (text: string): SessionTurn => ({
      role: "assistant",
      text,
    });

    it("merges consecutive turns of one role and starts with the user", () => {
      const { turns, droppedTurns } = prepareTranscript([
        assistant("stray reply"),
        user("question"),
        assistant("part one"),
        assistant("part two"),
      ]);

      expect(turns).toEqual([
        user("question"),
        assistant("part one\n\npart two"),
      ]);
      expect(droppedTurns).toBe(0);
    });

    it("clips one long turn and says so", () => {
      const { turns } = prepareTranscript([
        user("x".repeat(MAX_CHARS_PER_TURN + 500)),
      ]);

      expect(turns[0]?.text).toHaveLength(MAX_CHARS_PER_TURN);
      expect(turns[0]?.text.endsWith("[truncated]")).toBe(true);
    });

    it("never cuts through a surrogate pair, which the server refuses", () => {
      const { turns } = prepareTranscript([
        user(`a${"😀".repeat(MAX_CHARS_PER_TURN)}`),
      ]);

      expect(turns[0]?.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
      expect(turns[0]?.text.length).toBeLessThanOrEqual(MAX_CHARS_PER_TURN);
    });

    it("drops the oldest turns to fit the turn and character caps", () => {
      const source = Array.from({ length: 200 }, (_, index) =>
        index % 2 === 0 ? user(`q${index}`) : assistant(`a${index}`),
      );
      const byTurns = prepareTranscript(source);
      expect(byTurns.turns).toHaveLength(MAX_TURNS);
      expect(byTurns.turns.at(-1)?.text).toBe("a199");
      expect(byTurns.droppedTurns).toBe(80);

      const long = Array.from({ length: 60 }, (_, index) =>
        index % 2 === 0
          ? user(`${index} ${"y".repeat(3_000)}`)
          : assistant(`${index} ${"z".repeat(3_000)}`),
      );
      const byChars = prepareTranscript(long);
      const total = byChars.turns.reduce((sum, t) => sum + t.text.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
      expect(
        byChars.turns.every(
          (turn, index) =>
            turn.role === (index % 2 === 0 ? "user" : "assistant") &&
            turn.text !== "",
        ),
      ).toBe(true);
      expect(byChars.turns.at(-1)?.text.startsWith("59 ")).toBe(true);
    });

    it("returns nothing for a transcript with no user turn", () => {
      expect(prepareTranscript([assistant("hello")]).turns).toEqual([]);
    });
  });

  it("encodes turns as base64 gzip of the JSON array", () => {
    const turns: SessionTurn[] = [
      {
        role: "user",
        text: 'curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1/../../etc/passwd',
      },
      { role: "assistant", text: "ünïcode ✓" },
    ];

    const decoded = gunzipSync(Buffer.from(encodeTurns(turns), "base64"));

    expect(JSON.parse(decoded.toString("utf8"))).toEqual(turns);
  });
});
