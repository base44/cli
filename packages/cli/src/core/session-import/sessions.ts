import { createReadStream } from "node:fs";
import { realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { execa } from "execa";
import { globby } from "globby";
import { dir } from "tmp-promise";
import { getTestOverrides } from "@/core/config.js";
import { DependencyNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readFile } from "@/core/utils/fs.js";

export type SessionTool = "claude_code" | "codex";

export interface LocalSession {
  tool: SessionTool;
  path: string;
  updatedAt: Date;
  firstMessage: string;
}

const claudeDir = () =>
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const codexDir = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** Reads JSONL lines until `pick` returns a value. Session files can be large. */
async function scanLines<T>(
  path: string,
  pick: (entry: Record<string, unknown>) => T | undefined,
  maxLines = Number.POSITIVE_INFINITY,
): Promise<T | undefined> {
  const lines = createInterface({ input: createReadStream(path) });
  let count = 0;
  try {
    for await (const line of lines) {
      if (++count > maxLines) return undefined;
      try {
        const found = pick(JSON.parse(line));
        if (found !== undefined) return found;
      } catch {
        // A torn line (the file is being written) is normal.
      }
    }
  } finally {
    lines.close();
  }
  return undefined;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const codexCwd = (entry: Record<string, unknown>) =>
  entry.type === "session_meta"
    ? String(asRecord(entry.payload).cwd ?? "")
    : undefined;

async function newest(paths: string[]): Promise<string | undefined> {
  let best: { path: string; mtime: number } | undefined;
  for (const path of paths) {
    const { mtimeMs } = await stat(path);
    if (!best || mtimeMs > best.mtime) best = { path, mtime: mtimeMs };
  }
  return best?.path;
}

async function sameDir(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const [ra, rb] = await Promise.all([
    realpath(a).catch(() => a),
    realpath(b).catch(() => b),
  ]);
  return ra === rb;
}

const codexRollouts = () =>
  globby("sessions/*/*/*/rollout-*.jsonl", {
    cwd: codexDir(),
    absolute: true,
  });

async function codexRolloutsIn(cwd: string): Promise<string[]> {
  const matches: string[] = [];
  for (const path of await codexRollouts()) {
    const recorded = await scanLines(path, codexCwd, 1);
    if (recorded && (await sameDir(recorded, cwd))) matches.push(path);
  }
  return matches;
}

/** The file of the Claude Code or Codex session this process runs inside. */
export async function findCurrentSession(
  cwd: string,
): Promise<string | undefined> {
  const claudeId = process.env.CLAUDE_CODE_SESSION_ID;
  if (claudeId) {
    const [path] = await globby(`projects/*/${claudeId}.jsonl`, {
      cwd: claudeDir(),
      absolute: true,
    });
    return path;
  }
  // Codex sets CODEX_THREAD_ID for the commands it runs, and names the rollout
  // after it. Without it (older Codex), assume the newest rollout recorded in
  // this folder is the running one.
  const codexId = process.env.CODEX_THREAD_ID;
  if (codexId) {
    const rollouts = await codexRollouts();
    return rollouts.find((path) => path.endsWith(`-${codexId}.jsonl`));
  }
  return newest(await codexRolloutsIn(cwd));
}

function claudeUserText(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== "user" || entry.isMeta || entry.isSidechain) return;
  const content = asRecord(entry.message).content;
  // Command and caveat messages Claude Code injects start with a tag.
  return typeof content === "string" && !content.startsWith("<")
    ? content
    : undefined;
}

function codexUserText(entry: Record<string, unknown>): string | undefined {
  const payload = asRecord(entry.payload);
  return entry.type === "event_msg" && payload.type === "user_message"
    ? String(payload.message ?? "")
    : undefined;
}

const PICKER_LIMIT = 20;

/** This folder's Claude Code and Codex sessions, newest first. */
export async function listSessions(cwd: string): Promise<LocalSession[]> {
  // ponytail: Claude Code names the folder by replacing every
  // non-alphanumeric character of the cwd with "-".
  const claudeFolder = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const claude = await globby(`projects/${claudeFolder}/*.jsonl`, {
    cwd: claudeDir(),
    absolute: true,
  });
  const candidates = [
    ...claude.map((path) => ({ tool: "claude_code" as const, path })),
    ...(await codexRolloutsIn(cwd)).map((path) => ({
      tool: "codex" as const,
      path,
    })),
  ];
  const dated = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      updatedAt: (await stat(c.path)).mtime,
    })),
  );
  dated.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const sessions: LocalSession[] = [];
  for (const candidate of dated.slice(0, PICKER_LIMIT)) {
    const firstMessage = await scanLines(
      candidate.path,
      candidate.tool === "claude_code" ? claudeUserText : codexUserText,
    );
    if (firstMessage) sessions.push({ ...candidate, firstMessage });
  }
  return sessions;
}

const SESSION_ID = /session_[A-Za-z0-9]+/;

/** The `session_…` id in a claude.ai address, a bare id, or a `claude --teleport` command. */
export function parseSessionLink(link: string): string {
  if (/cshk_/.test(link) || !SESSION_ID.test(link)) {
    throw new InvalidInputError(
      `That isn't a claude.ai session address. Copy it from your browser's address bar (not "Copy link").`,
      { hints: [] },
    );
  }
  return (link.match(SESSION_ID) as RegExpMatchArray)[0];
}

const TELEPORT_PROMPT = "Reply with OK.";
const TELEPORT_NOTE = "This session is being continued from another machine";

function parseLine(line: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return {};
  }
}

/**
 * Drops what the teleport added: the queued TELEPORT_PROMPT (written as a
 * `queue-operation` line), the continued-from-another-machine note (a meta user
 * line), and the prompt's turn with everything after it, when it ran.
 */
function stripTeleportExchange(content: string): string {
  const lines = content.split("\n");
  const entries = lines.map(parseLine);
  const userText = (entry: Record<string, unknown>) =>
    entry.type === "user" ? asRecord(entry.message).content : undefined;

  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (userText(entries[i] ?? {}) === TELEPORT_PROMPT) {
      end = i;
      break;
    }
  }
  return lines
    .slice(0, end)
    .filter((_, i) => {
      const entry = entries[i] ?? {};
      const text = userText(entry);
      const queued =
        entry.type === "queue-operation" && entry.content === TELEPORT_PROMPT;
      const note = typeof text === "string" && text.startsWith(TELEPORT_NOTE);
      return !queued && !note;
    })
    .join("\n");
}

const NEEDS_CLAUDE =
  "Claude Code must be installed and signed in to the same claude.ai account to import a claude.ai session.";

/**
 * Pulls a claude.ai cloud session down with `claude --teleport` and returns its
 * file content. Teleport checks out the session's branch, so it runs in a temp
 * clone of this checkout's origin; the clone and its Claude project folder are
 * deleted afterwards.
 */
export async function teleportSession(
  sessionId: string,
  cwd: string,
): Promise<string> {
  const origin = await execa("git", ["remote", "get-url", "origin"], {
    cwd,
    reject: false,
  });
  if (origin.exitCode !== 0 || !origin.stdout) {
    throw new InvalidInputError(
      "Run this from a folder with the app's GitHub repository, so the session can be checked out.",
    );
  }

  const tmp = await dir({ unsafeCleanup: true });
  const repo = join(tmp.path, "repo");
  let projectFolder: string | undefined;
  try {
    await execa("git", ["clone", "--quiet", origin.stdout, repo]);
    const repoReal = await realpath(repo);
    const startedAt = Date.now();
    const claudeBin = getTestOverrides()?.claudeBin ?? "claude";
    try {
      await execa(claudeBin, ["--teleport", sessionId, "-p", TELEPORT_PROMPT], {
        cwd: repo,
        stdin: "ignore",
      });
    } catch {
      // Not chained: execa's message holds the command line and session id.
      throw new DependencyNotFoundError(NEEDS_CLAUDE, { hints: [] });
    }

    const fresh: string[] = [];
    for (const path of await globby("projects/*/*.jsonl", {
      cwd: claudeDir(),
      absolute: true,
    })) {
      if ((await stat(path)).mtimeMs < startedAt) continue;
      const sessionCwd = await scanLines(
        path,
        (entry) => (typeof entry.cwd === "string" ? entry.cwd : undefined),
        50,
      );
      if (sessionCwd === repo || sessionCwd === repoReal) fresh.push(path);
    }
    const file = await newest(fresh);
    if (!file) throw new DependencyNotFoundError(NEEDS_CLAUDE, { hints: [] });
    projectFolder = dirname(file);
    return stripTeleportExchange((await readFile(file)).toString("utf8"));
  } finally {
    // Only the temp clone writes to this folder, so all of it goes.
    if (projectFolder)
      await rm(projectFolder, { recursive: true, force: true });
    await tmp.cleanup();
  }
}
