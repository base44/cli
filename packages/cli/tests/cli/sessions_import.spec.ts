import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const APP_ID = "import-app";
const ROUTE = `/api/apps/${APP_ID}/imported/session-imports`;
const TOKEN = "b44imp_secret-key";

const SUCCESS = {
  branch_id: "b1",
  branch_name: "add-coupon-codes",
  source: "claude_code",
  turn_count: 14,
  branch_url: `/apps/${APP_ID}/editor/preview?branch=add-coupon-codes`,
  continued: false,
  source_ref: "main",
};

const claudeLines = (cwd: string, text: string) =>
  `${[
    { type: "user", cwd, message: { role: "user", content: text } },
    {
      type: "assistant",
      cwd,
      message: { role: "assistant", content: [{ type: "text", text: "Sure" }] },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n")}\n`;

interface Upload {
  authorization?: string;
  body: string;
}

describe("sessions import command", () => {
  const t = setupCLITests();
  let uploads: Upload[];

  const home = () => t.getTempDir();

  async function plant(relativePath: string, content: string) {
    const path = join(home(), relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
    return path;
  }

  function mockUpload(status = 200, body: unknown = SUCCESS) {
    t.api.mockRoute("POST", ROUTE, (req, res) => {
      uploads.push({
        authorization: req.headers.authorization,
        body: (req.body as Buffer).toString("utf8"),
      });
      res.status(status).json(body);
    });
  }

  beforeEach(() => {
    uploads = [];
    // execa inherits the developer's env, which may itself be a Claude Code session.
    t.givenEnv({
      CLAUDE_CODE_SESSION_ID: "",
      CLAUDE_CODE_REMOTE: "",
      CLAUDE_CONFIG_DIR: "",
      CODEX_HOME: "",
      CODEX_THREAD_ID: "",
    });
  });

  it("imports the current Claude Code session with an import key, without a login", async () => {
    await plant(
      ".claude/projects/-some-folder/abc-123.jsonl",
      claudeLines("/some/folder", "Add coupon codes"),
    );
    await plant(
      ".claude/projects/-other/zzz.jsonl",
      claudeLines("/other", "Not this one"),
    );
    t.givenEnv({ CLAUDE_CODE_SESSION_ID: "abc-123" });
    mockUpload();

    const result = await t.run(
      "sessions",
      "import",
      "--current",
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(
      'Imported 14 messages from Claude Code into branch "add-coupon-codes"',
    );
    t.expectResult(result).toContain(
      `/apps/${APP_ID}/editor/preview?branch=add-coupon-codes`,
    );
    t.expectResult(result).toContain("This uploads the full conversation");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(uploads[0]?.body).toContain("Add coupon codes");
    expect(uploads[0]?.body).not.toContain("Not this one");
    expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
  });

  it("imports the newest Codex session recorded in this folder", async () => {
    const meta = (cwd: string) =>
      `${JSON.stringify({ type: "session_meta", payload: { cwd } })}\n`;
    await plant(
      ".codex/sessions/2026/10/20/rollout-old.jsonl",
      `${meta(home())}{"note":"older"}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await plant(
      ".codex/sessions/2026/10/21/rollout-new.jsonl",
      `${meta(home())}{"note":"newest"}\n`,
    );
    await plant(
      ".codex/sessions/2026/10/22/rollout-elsewhere.jsonl",
      `${meta("/elsewhere")}{"note":"other folder"}\n`,
    );
    mockUpload(200, { ...SUCCESS, source: "codex" });

    const result = await t.run(
      "sessions",
      "import",
      "--current",
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("from Codex");
    expect(uploads[0]?.body).toContain("newest");
  });

  it("imports the Codex session named by CODEX_THREAD_ID", async () => {
    await plant(
      ".codex/sessions/2026/10/25/rollout-2026-10-25T15-41-21-thread-a.jsonl",
      '{"note":"this thread"}\n',
    );
    await plant(
      ".codex/sessions/2026/10/25/rollout-2026-10-25T15-42-00-thread-b.jsonl",
      '{"note":"other thread"}\n',
    );
    t.givenEnv({ CODEX_THREAD_ID: "thread-a" });
    mockUpload(200, { ...SUCCESS, source: "codex" });

    const result = await t.run(
      "sessions",
      "import",
      "--current",
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toSucceed();
    expect(uploads[0]?.body).toContain("this thread");
  });

  it("explains how to proceed when there is no current session", async () => {
    const result = await t.run(
      "sessions",
      "import",
      "--current",
      "--app-id",
      APP_ID,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Couldn't find the current session. Run this from inside Claude Code or Codex, or pass --file <path>.",
    );
    expect(uploads).toHaveLength(0);
  });

  it("returns the import as JSON with the full link", async () => {
    const file = await plant("s.jsonl", claudeLines("/x", "hi"));
    mockUpload();

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
      "--json",
    );

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toMatchObject({
      branchName: "add-coupon-codes",
      turnCount: 14,
      source: "claude_code",
      url: expect.stringMatching(
        new RegExp(`/apps/${APP_ID}/editor/preview\\?branch=add-coupon-codes$`),
      ),
    });
  });

  it("tells a reused key to copy a new prompt, and leaves the stored login alone", async () => {
    await t.givenLoggedIn({ email: "me@example.com", name: "Me" });
    const authBefore = await t.readAuthFile();
    const file = await plant("s.jsonl", claudeLines("/x", "hi"));
    mockUpload(401, {
      detail: "This import key is invalid, expired or already used.",
    });

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
      "--json",
    );

    t.expectResult(result).toFail();
    const envelope = JSON.parse(result.stdout);
    expect(envelope.error).toBe(
      "This import key expired or was already used. In Base Code, open Import session and copy a new prompt.",
    );
    expect(envelope.hints).toBeUndefined();
    expect(uploads).toHaveLength(1);
    expect(await t.readAuthFile()).toEqual(authBefore);
  });

  it.each([
    [403, "forbidden", "You don't have edit access to this app"],
    [404, "not_found", "Session import isn't available for this app."],
    [
      422,
      "unsupported_file",
      "That file isn't a Claude Code or Codex session.",
    ],
    [
      422,
      "repository_mismatch",
      "This session is from a different repository than the app.",
    ],
    [429, "rate_limited", "Too many imports. Wait a minute and try again."],
    [
      409,
      "repository_not_connected",
      "Connect this app to its GitHub repository in Base Code first.",
    ],
  ])("maps HTTP %i %s to a plain message", async (status, code, message) => {
    const file = await plant("s.jsonl", claudeLines("/x", "hi"));
    mockUpload(status, { error: { code, message: "server words" } });

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(message);
  });

  it("links to the existing branch when Base Code already has one", async () => {
    const file = await plant("s.jsonl", claudeLines("/x", "hi"));
    mockUpload(409, {
      error: {
        code: "branch_exists",
        message: "Base Code already has a branch for feature/x.",
        details: {
          branch_name: "feature/x",
          branch_url: `/apps/${APP_ID}/editor/preview?branch=feature%2Fx`,
        },
      },
    });

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Base Code already has feature/x. Open it: http",
    );
    t.expectResult(result).toContain(
      `/apps/${APP_ID}/editor/preview?branch=feature%2Fx`,
    );
  });

  it("says it continued on the session's branch when Base Code adopted it", async () => {
    const file = await plant("s.jsonl", claudeLines("/x", "hi"));
    mockUpload(200, {
      ...SUCCESS,
      branch_name: "feature/x",
      continued: true,
      source_ref: "feature/x",
    });

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(
      'Imported 14 messages from Claude Code. Continued on "feature/x".',
    );
  });

  it("explains that Codex cloud sessions can't be imported", async () => {
    // Codex cloud sets the thread id but writes no rollout file.
    t.givenEnv({ CODEX_THREAD_ID: "cloud-thread" });

    const result = await t.run(
      "sessions",
      "import",
      "--current",
      "--app-id",
      APP_ID,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Codex cloud sessions can't be imported yet. Run this from the Codex app or CLI on your computer.",
    );
    expect(uploads).toHaveLength(0);
  });

  it("uses the stored login when no key is given", async () => {
    await t.givenLoggedIn({ email: "me@example.com", name: "Me" });
    const file = await plant("s.jsonl", claudeLines("/x", "hi"));
    mockUpload();

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
    );

    t.expectResult(result).toSucceed();
    expect(uploads[0]?.authorization).toMatch(/^Bearer /);
    expect(uploads[0]?.authorization).not.toBe(`Bearer ${TOKEN}`);
  });

  it("refuses a file over 25 MB before uploading", async () => {
    const file = await plant("big.jsonl", "x".repeat(25 * 1024 * 1024 + 1));

    const result = await t.run(
      "sessions",
      "import",
      "--file",
      file,
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "This session is over 25 MB and can't be imported.",
    );
    expect(uploads).toHaveLength(0);
  });

  it("rejects a claude.ai 'Copy link' address", async () => {
    const result = await t.run(
      "sessions",
      "import",
      "https://claude.ai/code/cshk_abc123",
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "That isn't a claude.ai session address. Copy it from your browser's address bar",
    );
  });

  describe("git state of the checkout", () => {
    const git = (...args: string[]) =>
      execa(
        "git",
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: home() },
      );
    const SOURCE_BRANCH = /name="source_branch"\r\n\r\nfeature\r\n/;

    /** HOME is the checkout; ignoring everything keeps the planted sessions out of git status. */
    async function givenPushedBranch() {
      await git("init", "--quiet", "--bare", "origin.git");
      await git("init", "--quiet", "-b", "feature");
      await writeFile(join(home(), ".gitignore"), "*\n");
      await git("commit", "--quiet", "--allow-empty", "-m", "init");
      await git("remote", "add", "origin", join(home(), "origin.git"));
      await git("push", "--quiet", "-u", "origin", "feature");
    }

    async function runCurrent(...extra: string[]) {
      await plant(
        ".claude/projects/-f/abc-123.jsonl",
        claudeLines("/f", "Add coupon codes"),
      );
      t.givenEnv({ CLAUDE_CODE_SESSION_ID: "abc-123" });
      return t.run(
        "sessions",
        "import",
        "--current",
        "--app-id",
        APP_ID,
        "--token",
        TOKEN,
        ...extra,
      );
    }

    it("sends the pushed branch to start from", async () => {
      await givenPushedBranch();
      mockUpload();

      const result = await runCurrent();

      t.expectResult(result).toSucceed();
      expect(uploads[0]?.body).toMatch(SOURCE_BRANCH);
      t.expectResult(result).toNotContain("local changes aren't included");
    });

    it("stops before uploading when there are uncommitted changes", async () => {
      await givenPushedBranch();
      await writeFile(join(home(), "dirty.txt"), "x");
      await git("add", "-f", "dirty.txt");
      mockUpload();

      const result = await runCurrent();

      t.expectResult(result).toFail();
      t.expectResult(result).toContain(
        "Your changes aren't on GitHub yet. Ask the user whether to commit and push them",
      );
      t.expectResult(result).toContain("--skip-push-check");
      expect(uploads).toHaveLength(0);
    });

    it("stops when the branch was never pushed", async () => {
      await givenPushedBranch();
      await git("checkout", "--quiet", "-b", "local-only");
      mockUpload();

      const result = await runCurrent();

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("Your changes aren't on GitHub yet.");
      expect(uploads).toHaveLength(0);
    });

    it("stops when the branch has commits GitHub lacks", async () => {
      await givenPushedBranch();
      await git("commit", "--quiet", "--allow-empty", "-m", "local");
      mockUpload();

      const result = await runCurrent();

      t.expectResult(result).toFail();
      expect(uploads).toHaveLength(0);
    });

    it("imports without the local changes under --skip-push-check, and says so", async () => {
      await givenPushedBranch();
      await git("commit", "--quiet", "--allow-empty", "-m", "local");
      mockUpload();

      const result = await runCurrent("--skip-push-check", "--json");

      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout).note).toBe(
        "Base Code started from what's on GitHub; your local changes aren't included.",
      );
      expect(uploads[0]?.body).toMatch(SOURCE_BRANCH);
    });

    it("leaves out the branch when HEAD is detached", async () => {
      await givenPushedBranch();
      await git("checkout", "--quiet", "--detach");
      mockUpload();

      const result = await runCurrent();

      t.expectResult(result).toSucceed();
      expect(uploads[0]?.body).not.toContain('name="source_branch"');
    });

    it("doesn't check git for --file", async () => {
      await givenPushedBranch();
      await git("commit", "--quiet", "--allow-empty", "-m", "local");
      const file = await plant("s.jsonl", claudeLines("/x", "hi"));
      mockUpload();

      const result = await t.run(
        "sessions",
        "import",
        "--file",
        file,
        "--app-id",
        APP_ID,
        "--token",
        TOKEN,
      );

      t.expectResult(result).toSucceed();
      expect(uploads[0]?.body).not.toContain('name="source_branch"');
    });
  });

  it("teleports a claude.ai session, drops the teleport exchange, and cleans up", async () => {
    // The run's folder is a checkout whose origin is a local bare repo.
    await execa("git", ["init", "--quiet", "--bare", "origin.git"], {
      cwd: home(),
    });
    await execa("git", ["init", "--quiet"], { cwd: home() });
    await execa(
      "git",
      ["remote", "add", "origin", join(home(), "origin.git")],
      {
        cwd: home(),
      },
    );
    // A stand-in for `claude --teleport <id> -p "Reply with OK."`.
    const fakeClaude = await plant(
      "fake-claude.mjs",
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [flag, id] = process.argv.slice(2);
if (flag !== "--teleport" || id !== "session_01AbC") process.exit(1);
const cwd = process.cwd();
const dir = join(process.env.HOME, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const lines = [
  { type: "queue-operation", operation: "enqueue", content: "Reply with OK." },
  { type: "user", cwd, message: { role: "user", content: "Cloud question" } },
  { type: "assistant", cwd, message: { role: "assistant", content: [{ type: "text", text: "Cloud answer" }] } },
  { type: "user", isMeta: true, cwd, message: { role: "user", content: "This session is being continued from another machine. Application state may have changed." } },
  { type: "user", cwd, message: { role: "user", content: "Reply with OK." } },
  { type: "assistant", cwd, message: { role: "assistant", content: [{ type: "text", text: "OK" }] } },
];
writeFileSync(join(dir, "local-id.jsonl"), lines.map((l) => JSON.stringify(l)).join("\\n") + "\\n");
`,
    );
    await chmod(fakeClaude, 0o755);
    t.givenClaudeBin(fakeClaude);
    mockUpload();

    const result = await t.run(
      "sessions",
      "import",
      "https://claude.ai/code/session_01AbC?from=cli&m=0",
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toSucceed();
    const body = uploads[0]?.body ?? "";
    expect(body).toContain("Cloud question");
    expect(body).toContain("Cloud answer");
    expect(body).not.toContain("Reply with OK.");
    expect(body).not.toContain("continued from another machine");
    // The checkout here is dirty, but a link's changes live in the cloud.
    expect(body).not.toContain('name="source_branch"');
    // The teleported project folder is gone.
    expect(await readdir(join(home(), ".claude", "projects"))).toEqual([]);
  });

  it("explains that Claude Code is needed when teleport fails", async () => {
    await execa("git", ["init", "--quiet", "--bare", "origin.git"], {
      cwd: home(),
    });
    await execa("git", ["init", "--quiet"], { cwd: home() });
    await execa(
      "git",
      ["remote", "add", "origin", join(home(), "origin.git")],
      {
        cwd: home(),
      },
    );
    t.givenClaudeBin(join(home(), "no-such-claude"));

    const result = await t.run(
      "sessions",
      "import",
      "claude --teleport session_01AbC",
      "--app-id",
      APP_ID,
      "--token",
      TOKEN,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Claude Code must be installed and signed in to the same claude.ai account",
    );
  });
});
