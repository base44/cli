import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";
import { FileReadError } from "@/core/errors.js";
import {
  claudeTurnFromLine,
  codexTurnFromLine,
  cut,
  objectField,
  parseJsonObject,
  type SessionSource,
  type SessionTurn,
  stringField,
} from "@/core/session-import/transcript.js";

export interface SessionRoots {
  claudeProjectsDir: string;
  codexHome: string;
}

export function defaultSessionRoots(): SessionRoots {
  const claudeHome =
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return {
    claudeProjectsDir: join(claudeHome, "projects"),
    codexHome: process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  };
}

export interface LocalSession {
  source: SessionSource;
  id: string;
  title: string;
  cwd?: string;
  filePath: string;
  updatedAtMs: number;
}

interface SessionFile {
  source: SessionSource;
  id: string;
  filePath: string;
  updatedAtMs: number;
}

interface SessionHead {
  cwd?: string;
  /** Not a conversation anyone resumes, such as a headless `codex exec` run. */
  skip?: boolean;
}

interface SessionContent {
  cwd?: string;
  title?: string;
  turns: SessionTurn[];
}

interface SessionAdapter {
  files(): Promise<SessionFile[]>;
  head(filePath: string): Promise<SessionHead>;
  read(file: SessionFile): Promise<SessionContent>;
}

const CODEX_ROLLOUT_FILE =
  /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const MAX_TITLE_CHARS = 80;

type JsonObject = NonNullable<ReturnType<typeof parseJsonObject>>;

/** Streams a file's JSON lines; `onObject` returns false to stop reading. */
async function forEachJsonObject(
  filePath: string,
  onObject: (object: JsonObject) => boolean | undefined,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  try {
    for await (const line of lines) {
      const object = parseJsonObject(line);
      if (object && onObject(object) === false) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function withMtime(
  files: Omit<SessionFile, "updatedAtMs">[],
): Promise<SessionFile[]> {
  const stamped = await Promise.all(
    files.map(async (file) => {
      try {
        return { ...file, updatedAtMs: (await stat(file.filePath)).mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  return stamped.filter((file) => file !== undefined);
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_TITLE_CHARS
    ? flat
    : `${cut(flat, MAX_TITLE_CHARS - 1)}…`;
}

/** `<projects>/<escaped-cwd>/<id>.jsonl`, one level deep: `<id>/subagents/` holds sidechains. */
function claudeAdapter(projectsDir: string): SessionAdapter {
  return {
    async files() {
      const found: Omit<SessionFile, "updatedAtMs">[] = [];
      for (const project of await listDir(projectsDir)) {
        if (!project.isDirectory()) continue;
        const projectDir = join(projectsDir, project.name);
        for (const entry of await listDir(projectDir)) {
          if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            found.push({
              source: "claude_code",
              id: entry.name.slice(0, -".jsonl".length),
              filePath: join(projectDir, entry.name),
            });
          }
        }
      }
      return withMtime(found);
    },
    async head(filePath) {
      let cwd: string | undefined;
      await forEachJsonObject(filePath, (line) => {
        cwd = stringField(line, "cwd");
        return cwd === undefined;
      });
      return { cwd };
    },
    async read(file) {
      const turns: SessionTurn[] = [];
      let cwd: string | undefined;
      let customTitle: string | undefined;
      let aiTitle: string | undefined;
      let summary: string | undefined;
      await forEachJsonObject(file.filePath, (line) => {
        const type = stringField(line, "type");
        if (type === "custom-title") {
          customTitle = stringField(line, "customTitle") ?? customTitle;
        } else if (type === "ai-title") {
          aiTitle = stringField(line, "aiTitle") ?? aiTitle;
        } else if (type === "summary") {
          summary = stringField(line, "summary") ?? summary;
        } else {
          cwd ??= stringField(line, "cwd");
          const turn = claudeTurnFromLine(line);
          if (turn) turns.push(turn);
        }
        return undefined;
      });
      return { cwd, title: customTitle ?? aiTitle ?? summary, turns };
    },
  };
}

/** `<codexHome>/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl`; names live in `session_index.jsonl`. */
function codexAdapter(codexHome: string): SessionAdapter {
  const sessionsDir = join(codexHome, "sessions");
  const titleOf = async (id: string) => {
    let title: string | undefined;
    try {
      await forEachJsonObject(
        join(codexHome, "session_index.jsonl"),
        (line) => {
          if (stringField(line, "id") === id) {
            title = stringField(line, "thread_name") ?? title;
          }
          return undefined;
        },
      );
    } catch {
      // No index: fall back to the first prompt.
    }
    return title;
  };
  return {
    async files() {
      const found: Omit<SessionFile, "updatedAtMs">[] = [];
      for (const year of await listDir(sessionsDir)) {
        for (const month of await listDir(join(sessionsDir, year.name))) {
          const monthDir = join(sessionsDir, year.name, month.name);
          for (const day of await listDir(monthDir)) {
            const dayDir = join(monthDir, day.name);
            for (const entry of await listDir(dayDir)) {
              const id = CODEX_ROLLOUT_FILE.exec(entry.name)?.[1];
              if (id && entry.isFile()) {
                found.push({
                  source: "codex",
                  id,
                  filePath: join(dayDir, entry.name),
                });
              }
            }
          }
        }
      }
      return withMtime(found);
    },
    async head(filePath) {
      const head: SessionHead = {};
      await forEachJsonObject(filePath, (line) => {
        const payload = objectField(line, "payload");
        if (stringField(line, "type") !== "session_meta" || !payload) {
          return true;
        }
        head.cwd = stringField(payload, "cwd");
        // Interactive threads carry a string source ("cli", "vscode"). Headless
        // `exec` runs and subagent threads (an object source) are not resumed.
        const source = payload.source;
        head.skip = typeof source !== "string" || source === "exec";
        return false;
      });
      return head;
    },
    async read(file) {
      const turns: SessionTurn[] = [];
      let cwd: string | undefined;
      await forEachJsonObject(file.filePath, (line) => {
        const payload = objectField(line, "payload");
        if (stringField(line, "type") === "session_meta" && payload) {
          cwd ??= stringField(payload, "cwd");
        }
        const turn = codexTurnFromLine(line);
        if (turn) turns.push(turn);
        return undefined;
      });
      return { cwd, title: await titleOf(file.id), turns };
    },
  };
}

function adapters(roots: SessionRoots): SessionAdapter[] {
  return [
    claudeAdapter(roots.claudeProjectsDir),
    codexAdapter(roots.codexHome),
  ];
}

async function describe(
  adapter: SessionAdapter,
  file: SessionFile,
): Promise<{ session: LocalSession; turns: SessionTurn[] } | undefined> {
  const content = await adapter.read(file);
  const firstPrompt = content.turns.find((turn) => turn.role === "user")?.text;
  const title = oneLine(content.title ?? firstPrompt ?? "");
  if (content.turns.length === 0 || title === "") return undefined;
  return {
    session: {
      source: file.source,
      id: file.id,
      title,
      cwd: content.cwd,
      filePath: file.filePath,
      updatedAtMs: file.updatedAtMs,
    },
    turns: content.turns,
  };
}

async function isWithin(cwd: string, dir: string): Promise<boolean> {
  const roots = new Set([dir, await realpath(dir).catch(() => dir)]);
  const places = new Set([cwd, await realpath(cwd).catch(() => cwd)]);
  return [...roots].some((root) =>
    [...places].some((place) => place === root || place.startsWith(root + sep)),
  );
}

interface ListSessionsOptions {
  /** Only sessions started in this directory or below it. */
  within?: string;
  limit: number;
}

/** Newest first. Sessions with no conversation text are left out. */
export async function listSessions(
  roots: SessionRoots,
  { within, limit }: ListSessionsOptions,
): Promise<LocalSession[]> {
  const found: LocalSession[] = [];
  const files = (
    await Promise.all(
      adapters(roots).map(async (adapter) =>
        (await adapter.files()).map((file) => ({ adapter, file })),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.file.updatedAtMs - a.file.updatedAtMs);
  for (const { adapter, file } of files) {
    if (found.length >= limit) break;
    const head = await adapter
      .head(file.filePath)
      .catch(() => ({ skip: true }) as SessionHead);
    if (head.skip) continue;
    if (within && (!head.cwd || !(await isWithin(head.cwd, within)))) continue;
    const described = await describe(adapter, file).catch(() => undefined);
    if (described) found.push(described.session);
  }
  return found;
}

/** The session with this exact id, from any directory. */
export async function readSessionById(
  roots: SessionRoots,
  id: string,
): Promise<{ session: LocalSession; turns: SessionTurn[] } | undefined> {
  for (const adapter of adapters(roots)) {
    const file = (await adapter.files()).find(
      (candidate) => candidate.id === id,
    );
    if (!file) continue;
    try {
      return await describe(adapter, file);
    } catch (error) {
      throw new FileReadError(
        `Failed to read session file ${file.filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }
  return undefined;
}
