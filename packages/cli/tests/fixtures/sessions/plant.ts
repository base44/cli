import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const CLAUDE_SESSION_ID = "3f2a9c1e-5b7d-4e08-9a64-1c2d3e4f5a6b";
export const CODEX_THREAD_ID = "019a2b3c-4d5e-7f60-8a91-b2c3d4e5f607";
const CODEX_EXEC_THREAD_ID = "019a2b3c-4d5e-7f60-8a91-b2c3d4e5f608";
const CODEX_SUBAGENT_THREAD_ID = "019a2b3c-4d5e-7f60-8a91-b2c3d4e5f609";

async function fixtureText(name: string, cwd: string): Promise<string> {
  const text = await readFile(resolve(__dirname, name), "utf8");
  return text.replaceAll("__CWD__", JSON.stringify(cwd).slice(1, -1));
}

async function place(
  filePath: string,
  content: string,
  mtime: Date,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  await utimes(filePath, mtime, mtime);
}

/** Writes the Claude Code fixture where `~/.claude/projects` keeps a session started in `cwd`. */
export async function plantClaudeSession(
  home: string,
  cwd: string,
  options: { id?: string; mtime?: Date } = {},
): Promise<string> {
  const id = options.id ?? CLAUDE_SESSION_ID;
  const text = (await fixtureText("claude-session.jsonl", cwd)).replaceAll(
    CLAUDE_SESSION_ID,
    id,
  );
  const filePath = join(
    home,
    ".claude",
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${id}.jsonl`,
  );
  await place(filePath, text, options.mtime ?? new Date());
  return filePath;
}

/** Writes the Codex fixtures where `~/.codex` keeps rollouts, plus a headless `exec` run, a subagent thread and the name index. */
export async function plantCodexSessions(
  home: string,
  cwd: string,
  options: { mtime?: Date } = {},
): Promise<void> {
  const mtime = options.mtime ?? new Date();
  const day = join(home, ".codex", "sessions", "2026", "10", "18");
  await place(
    join(day, `rollout-2026-10-18T09-00-00-${CODEX_THREAD_ID}.jsonl`),
    await fixtureText("codex-rollout.jsonl", cwd),
    mtime,
  );
  await place(
    join(day, `rollout-2026-10-18T09-30-00-${CODEX_EXEC_THREAD_ID}.jsonl`),
    await fixtureText("codex-exec-rollout.jsonl", cwd),
    mtime,
  );
  await place(
    join(day, `rollout-2026-10-18T09-45-00-${CODEX_SUBAGENT_THREAD_ID}.jsonl`),
    await fixtureText("codex-subagent-rollout.jsonl", cwd),
    mtime,
  );
  await place(
    join(home, ".codex", "session_index.jsonl"),
    await fixtureText("codex-session-index.jsonl", cwd),
    mtime,
  );
}
