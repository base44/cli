import { gzipSync } from "node:zlib";

export type SessionSource = "claude_code" | "codex";

export const SESSION_SOURCE_LABELS: Record<SessionSource, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
};

export interface SessionTurn {
  role: "user" | "assistant";
  text: string;
}

export const MAX_TURNS = 120;
export const MAX_CHARS_PER_TURN = 4_000;
// The server refuses more than this much text in total.
export const MAX_TOTAL_CHARS = 100_000;
const TRUNCATION_MARK = " … [truncated]";

type JsonObject = Record<string, unknown>;

export function parseJsonObject(line: string): JsonObject | undefined {
  if (line[0] !== "{") return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

export function stringField(
  object: JsonObject,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function objectField(
  object: JsonObject,
  key: string,
): JsonObject | undefined {
  const value = object[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

/** The joined text blocks of a message's content; tool results and images add nothing. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" &&
      block !== null &&
      typeof (block as JsonObject).text === "string"
        ? ((block as JsonObject).text as string)
        : "",
    )
    .filter((text) => text !== "")
    .join("\n")
    .trim();
}

/**
 * Injected context (system reminders, slash-command records, environment blocks)
 * opens with an angle bracket and is never part of the conversation.
 */
function conversationTurn(
  role: SessionTurn["role"],
  content: unknown,
): SessionTurn | undefined {
  const text = contentText(content);
  return text === "" ||
    text.startsWith("<") ||
    text.startsWith(INTERRUPT_MARKER)
    ? undefined
    : { role, text };
}

const NOT_CONVERSATION_FLAGS = [
  "isMeta",
  "isSidechain",
  "isCompactSummary",
  "isVisibleInTranscriptOnly",
  "isApiErrorMessage",
];
const INTERRUPT_MARKER = "[Request interrupted by user";
const SLASH_COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/;
const SLASH_COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/;

/** A slash command's record, `/name args`, is what the user typed; its expanded body is not. */
function slashCommandText(text: string): string | undefined {
  const name = SLASH_COMMAND_NAME.exec(text)?.[1]?.trim();
  if (!name) return undefined;
  const args = SLASH_COMMAND_ARGS.exec(text)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

export function claudeTurnFromLine(line: JsonObject): SessionTurn | undefined {
  const type = stringField(line, "type");
  if (type !== "user" && type !== "assistant") return undefined;
  // Flags on lines Claude Code wrote itself: an expanded skill body, a compaction
  // summary, an API error. None of them is something the user or model said.
  if (NOT_CONVERSATION_FLAGS.some((flag) => line[flag] === true)) {
    return undefined;
  }
  const message = objectField(line, "message");
  if (message?.model === "<synthetic>") return undefined;
  const content = message?.content;
  const command =
    type === "user" ? slashCommandText(contentText(content)) : undefined;
  return command
    ? { role: "user", text: command }
    : conversationTurn(type, content);
}

/** Codex front-loads user items the user never typed. */
const CODEX_INJECTED_USER_ITEM =
  /^\s*(<(recommended_plugins|environment_context|user_instructions)>|# AGENTS\.md instructions for )/;

export function codexTurnFromLine(line: JsonObject): SessionTurn | undefined {
  if (stringField(line, "type") !== "response_item") return undefined;
  const payload = objectField(line, "payload");
  if (payload === undefined || payload.type !== "message") return undefined;
  const role = payload.role;
  if (role !== "user" && role !== "assistant") return undefined;
  const turn = conversationTurn(role, payload.content);
  if (turn?.role === "user" && CODEX_INJECTED_USER_ITEM.test(turn.text)) {
    return undefined;
  }
  return turn;
}

/** Claude Code writes one line per content block, so consecutive turns can share a role. */
function mergeConsecutiveRoles(turns: SessionTurn[]): SessionTurn[] {
  const merged: SessionTurn[] = [];
  for (const turn of turns) {
    const last = merged.at(-1);
    if (last?.role === turn.role) {
      last.text = `${last.text}\n\n${turn.text}`;
    } else {
      merged.push({ ...turn });
    }
  }
  return merged;
}

/** Cut to `maxChars` UTF-16 units without splitting a surrogate pair, which the server refuses. */
export function cut(text: string, maxChars: number): string {
  const end = text.charCodeAt(maxChars - 1);
  return text.slice(
    0,
    end >= 0xd800 && end <= 0xdbff ? maxChars - 1 : maxChars,
  );
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars
    ? text
    : cut(text, maxChars - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}

interface PreparedTranscript {
  turns: SessionTurn[];
  /** Oldest turns dropped because the conversation exceeds the caps. */
  droppedTurns: number;
}

/**
 * The turns the server accepts: alternating, starting with the user, within
 * the turn and character caps. Newest turns win, so the oldest are dropped first.
 */
export function prepareTranscript(source: SessionTurn[]): PreparedTranscript {
  const merged = mergeConsecutiveRoles(source).map((turn) => ({
    role: turn.role,
    text: clip(turn.text, MAX_CHARS_PER_TURN),
  }));
  let kept = merged.slice(-MAX_TURNS);
  let total = kept.reduce((sum, turn) => sum + turn.text.length, 0);
  while (kept.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= kept[0]?.text.length ?? 0;
    kept = kept.slice(1);
  }
  const droppedTurns = merged.length - kept.length;
  const firstUser = kept.findIndex((turn) => turn.role === "user");
  return {
    turns: firstUser === -1 ? [] : kept.slice(firstUser),
    droppedTurns,
  };
}

/** `base64(gzip(JSON))`: raw transcripts that quote shell commands trip Cloudflare's WAF. */
export function encodeTurns(turns: SessionTurn[]): string {
  return gzipSync(JSON.stringify(turns), { level: 9 }).toString("base64");
}
