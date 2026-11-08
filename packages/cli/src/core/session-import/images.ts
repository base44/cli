import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { readFile } from "@/core/utils/fs.js";

type Entry = Record<string, unknown>;

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
// Base Code imports only the newest 20 pasted images.
const MAX_ATTACHED_IMAGES = 20;
const MAX_ATTACHED_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_PATH =
  /(?:\/|[A-Za-z]:\\)[^\s"'`<>()]+\.(?:png|jpe?g|gif|webp)\b/gi;

const asRecord = (value: unknown): Entry =>
  value && typeof value === "object" ? (value as Entry) : {};

const isImage = (value: unknown) =>
  ["image", "input_image"].includes(String(asRecord(value).type));

function withoutImages(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => !isImage(item)).map(withoutImages);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutImages(item)]),
    );
  }
  return value;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings);
  }
  return [];
}
const payloadOf = (entry: Entry) => asRecord(entry.payload);
const messageOf = (entry: Entry) => asRecord(entry.message);

/** A message the person typed: the only place an attached file's path counts. */
function isTypedUserMessage(entry: Entry): boolean {
  if (entry.type === "user") {
    if (entry.isMeta || entry.isSidechain) return false;
    const content = asRecord(entry.message).content;
    return (
      typeof content === "string" ||
      (Array.isArray(content) &&
        !content.some((block) => asRecord(block).type === "tool_result"))
    );
  }
  const payload = asRecord(entry.payload);
  return (
    entry.type === "response_item" &&
    payload.type === "message" &&
    payload.role === "user"
  );
}

/** The arguments of every tool call: an attached file counts once the agent opened it. */
function toolInputs(entries: Entry[]): string {
  return entries
    .flatMap((entry) => {
      const payload = asRecord(entry.payload);
      if (entry.type === "response_item") {
        return String(payload.type).endsWith("_call")
          ? strings([payload.input, payload.arguments])
          : [];
      }
      const content = messageOf(entry).content;
      return (Array.isArray(content) ? content : [])
        .filter((block) => asRecord(block).type === "tool_use")
        .flatMap((block) => strings(asRecord(block).input));
    })
    .join("\n");
}

async function imageBlock(path: string, codex: boolean) {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  const size = await stat(path).then(
    (info) => (info.isFile() ? info.size : 0),
    () => 0,
  );
  if (!mediaType || !size || size > MAX_ATTACHED_IMAGE_BYTES) return undefined;
  const data = (await readFile(path)).toString("base64");
  return codex
    ? { type: "input_image", image_url: `data:${mediaType};base64,${data}` }
    : {
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      };
}

/**
 * Prepares a session file for upload. Images the agent's tools produced
 * (screenshots, a Read of a PNG) are dropped: Base Code never imports them, and
 * they are most of a big session's size. An image the user attached as a file
 * path (as apps that wrap Claude Code or Codex do) and the agent then opened is
 * added to the user's message, as if it had been pasted.
 */
export async function prepareSessionImages(
  content: Uint8Array,
): Promise<Uint8Array> {
  const lines = Buffer.from(content).toString("utf8").split("\n");
  const entries = lines.map((line): Entry | undefined => {
    try {
      const entry = JSON.parse(line);
      return entry && typeof entry === "object" ? entry : undefined;
    } catch {
      return undefined;
    }
  });
  const changed = new Set<number>();

  entries.forEach((entry, i) => {
    if (!entry || !lines[i]?.includes("image")) return;
    const message = messageOf(entry);
    if (
      entry.type === "user" &&
      Array.isArray(message.content) &&
      message.content.some((block) => asRecord(block).type === "tool_result")
    ) {
      const content = message.content.map((block) =>
        asRecord(block).type === "tool_result" ? withoutImages(block) : block,
      );
      // toolUseResult repeats the tool's output, a Read image's base64 included.
      const { toolUseResult: _, ...rest } = entry;
      entries[i] = { ...rest, message: { ...message, content } };
      changed.add(i);
    } else if (
      entry.type === "response_item" &&
      String(asRecord(entry.payload).type).endsWith("_output")
    ) {
      entries[i] = { ...entry, payload: withoutImages(entry.payload) };
      changed.add(i);
    }
  });

  const opened = toolInputs(entries.filter((entry) => !!entry) as Entry[]);
  let budget = MAX_ATTACHED_IMAGES;
  for (let i = entries.length - 1; i >= 0 && budget > 0; i--) {
    const entry = entries[i];
    if (!entry || !isTypedUserMessage(entry)) continue;
    const codex = entry.type === "response_item";
    const raw = codex ? payloadOf(entry).content : messageOf(entry).content;
    const blocks: unknown[] =
      typeof raw === "string"
        ? [{ type: "text", text: raw }]
        : Array.isArray(raw)
          ? [...raw]
          : [];
    const paths = new Set(
      strings(blocks.filter((block) => !isImage(block))).flatMap(
        (text) => text.match(IMAGE_PATH) ?? [],
      ),
    );
    const added = [];
    for (const path of paths) {
      if (budget === 0 || !opened.includes(path)) continue;
      const block = await imageBlock(path, codex);
      if (block) {
        added.push(block);
        budget--;
      }
    }
    if (!added.length) continue;
    entries[i] = codex
      ? {
          ...entry,
          payload: { ...payloadOf(entry), content: [...blocks, ...added] },
        }
      : {
          ...entry,
          message: { ...messageOf(entry), content: [...blocks, ...added] },
        };
    changed.add(i);
  }

  if (!changed.size) return content;
  return Buffer.from(
    lines
      .map((line, i) => (changed.has(i) ? JSON.stringify(entries[i]) : line))
      .join("\n"),
  );
}
