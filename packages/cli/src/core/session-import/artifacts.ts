import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export interface SessionArtifact {
  toolUseId: string;
  fileName: string;
  data: Buffer;
}

interface SkippedArtifact {
  fileName: string;
  reason: string;
}

type Entry = Record<string, unknown>;

interface Found {
  toolUseId: string;
  path: string;
  // Claude Code only: the Artifact's supporting files, and a Write to fall back on.
  claude: boolean;
  files?: Record<string, string>;
}

const ALLOWED = new Set(
  "html htm pdf png jpg jpeg gif webp txt md csv json".split(" "),
);
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
// Cloudflare refuses bodies over 100 MB; the server caps the request at 95 MB.
const MAX_REQUEST_BYTES = 95 * 1024 * 1024;
const MULTIPART_MARGIN = 1024 * 1024;
const OPENS_FILE = /open_in_codex\(\s*\{\s*["']?target["']?\s*:\s*\{([^}]*)\}/g;
const FILE_TARGET = /["']?type["']?\s*:\s*["']file["']/;
const TARGET_PATH =
  /(?:^|[\s,])["']?path["']?\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/;
const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;

const asRecord = (value: unknown): Entry =>
  value && typeof value === "object" ? (value as Entry) : {};

function toolUses(entry: Entry): Entry[] {
  const content = asRecord(entry.message).content;
  return (Array.isArray(content) ? content : [])
    .map(asRecord)
    .filter((block) => block.type === "tool_use");
}

function findArtifacts(entries: Entry[]): Found[] {
  const found: Found[] = [];
  for (const entry of entries) {
    const cwd = typeof entry.cwd === "string" ? entry.cwd : "";
    if (entry.type === "assistant" && !entry.isSidechain) {
      for (const block of toolUses(entry)) {
        const input = asRecord(block.input);
        if (
          block.name === "Artifact" &&
          typeof block.id === "string" &&
          typeof input.file_path === "string" &&
          (input.action ?? "publish") === "publish" &&
          !input.asset &&
          !input.type_url
        ) {
          const files = Object.fromEntries(
            Object.entries(asRecord(input.files))
              .filter(([, local]) => typeof local === "string")
              .map(([key, local]) => [key, resolve(cwd, local as string)]),
          );
          found.push({
            toolUseId: block.id,
            path: input.file_path,
            claude: true,
            files,
          });
        }
      }
    }
    const payload = asRecord(entry.payload);
    if (
      entry.type === "response_item" &&
      payload.type === "custom_tool_call" &&
      payload.name === "exec" &&
      typeof payload.input === "string" &&
      typeof payload.call_id === "string"
    ) {
      for (const [, target = ""] of payload.input.matchAll(OPENS_FILE)) {
        if (!FILE_TARGET.test(target)) continue;
        const path = TARGET_PATH.exec(target)?.[2]?.replace(/\\(.)/g, "$1");
        if (path)
          found.push({ toolUseId: payload.call_id, path, claude: false });
      }
    }
  }
  return found;
}

/** The last Write of `path` that no Edit changed afterwards. */
function lastCleanWrite(entries: Entry[], path: string): Buffer | undefined {
  let content: string | undefined;
  for (const entry of entries) {
    for (const block of toolUses(entry)) {
      const input = asRecord(block.input);
      if (input.file_path !== path) continue;
      if (block.name === "Write" && typeof input.content === "string") {
        content = input.content;
      } else if (block.name === "Edit" || block.name === "MultiEdit") {
        content = undefined;
      }
    }
  }
  return content === undefined ? undefined : Buffer.from(content);
}

const readRegularFile = (path: string) =>
  stat(path).then(
    (info) => (info.isFile() ? readFile(path) : undefined),
    () => undefined,
  );

async function inlineImages(
  html: Buffer,
  files: Record<string, string>,
): Promise<Buffer> {
  const text = html.toString("utf8");
  const uris = new Map<string, string>();
  for (const [, , , src = ""] of text.matchAll(IMG_SRC)) {
    const local = files[src];
    const mediaType = local && IMAGE_TYPES[extname(local).toLowerCase()];
    const data = mediaType && (await readRegularFile(local));
    if (data)
      uris.set(src, `data:${mediaType};base64,${data.toString("base64")}`);
  }
  if (!uris.size) return html;
  return Buffer.from(
    text.replace(IMG_SRC, (match, prefix, quote, src) => {
      const uri = uris.get(src);
      return uri ? `${prefix}${quote}${uri}${quote}` : match;
    }),
  );
}

/**
 * The files of the artifacts a session presented (Claude Code `Artifact`
 * publishes, Codex app `open_in_codex` of a file), read from the paths those
 * calls name and nowhere else. `budget` is what the request has left for them.
 */
export async function collectArtifacts(
  session: Uint8Array,
  budget = MAX_REQUEST_BYTES - session.length - MULTIPART_MARGIN,
): Promise<{ artifacts: SessionArtifact[]; skipped: SkippedArtifact[] }> {
  const entries = Buffer.from(session)
    .toString("utf8")
    .split("\n")
    .map((line) => {
      try {
        return asRecord(JSON.parse(line));
      } catch {
        return {};
      }
    });
  // The newest call per path, ordered by when it was last presented.
  const byPath = new Map<string, Found>();
  for (const found of findArtifacts(entries)) {
    byPath.delete(found.path);
    byPath.set(found.path, found);
  }
  const newest = [...byPath.values()];
  const skipped: SkippedArtifact[] = newest
    .slice(0, -MAX_FILES)
    .map(({ path }) => ({
      fileName: basename(path),
      reason: `only the newest ${MAX_FILES} are sent`,
    }));

  const artifacts: SessionArtifact[] = [];
  for (const found of newest.slice(-MAX_FILES)) {
    const fileName = basename(found.path);
    if (!ALLOWED.has(extname(fileName).slice(1).toLowerCase())) {
      skipped.push({ fileName, reason: "its file type isn't supported" });
      continue;
    }
    let data =
      (await readRegularFile(found.path)) ??
      (found.claude ? lastCleanWrite(entries, found.path) : undefined);
    if (!data) {
      skipped.push({ fileName, reason: "the file isn't on disk anymore" });
      continue;
    }
    if (found.files && /\.html?$/i.test(fileName)) {
      data = await inlineImages(data, found.files);
    }
    if (data.length > MAX_BYTES) {
      skipped.push({ fileName, reason: "it's larger than 10 MB" });
      continue;
    }
    artifacts.push({ toolUseId: found.toolUseId, fileName, data });
  }

  let total = artifacts.reduce((sum, { data }) => sum + data.length, 0);
  while (total > budget) {
    const oldest = artifacts.shift() as SessionArtifact;
    total -= oldest.data.length;
    skipped.push({
      fileName: oldest.fileName,
      reason: "the upload would be over 95 MB",
    });
  }
  return { artifacts, skipped };
}
