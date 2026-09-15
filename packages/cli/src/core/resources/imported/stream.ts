import type { ConversationMessage } from "@/core/resources/imported/api.js";
import { getFullConversation } from "@/core/resources/imported/api.js";

export type StreamEvent =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool_start"; id: string; name: string; summary: string }
  | {
      kind: "tool_end";
      id: string;
      name: string;
      summary: string;
      ok: boolean;
      result: string;
    };

interface MessageProgress {
  contentLength: number;
  reasoningLength: number;
  announcedTools: Map<string, string>; // tool id -> summary
  settledTools: Set<string>;
}

interface StreamState {
  perMessage: Map<string, MessageProgress>;
}

export function newStreamState(): StreamState {
  return { perMessage: new Map() };
}

const TOOL_SETTLED = new Set(["success", "error", "stopped"]);

function oneLine(value: unknown, max: number): string {
  const text =
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const SALIENT_KEYS = ["command", "path", "file_path", "title", "summary"];

/** Pull a salient value out of TRUNCATED arguments JSON (the wire cuts big
 * payloads mid-string, so JSON.parse fails while the key we want survived). */
function salvageFromTruncated(raw: string): string | undefined {
  for (const key of SALIENT_KEYS) {
    const match = raw.match(
      new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    );
    if (match?.[1]) return match[1].replace(/\\(.)/g, "$1");
  }
  return undefined;
}

/** The one argument a human wants to see for each tool, not the JSON blob. */
export function toolSummary(
  name: string,
  argumentsString: string | null | undefined,
): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(argumentsString ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    const salvaged = salvageFromTruncated(argumentsString ?? "");
    return oneLine(salvaged ?? argumentsString ?? "", 90);
  }
  const pick = (key: string): string | undefined =>
    typeof args[key] === "string" && (args[key] as string).trim()
      ? (args[key] as string)
      : undefined;
  const salient: Record<string, string | undefined> = {
    run_shell_command: pick("command"),
    read_repo_file: pick("path") ?? pick("file_path"),
    write_repo_file: pick("path") ?? pick("file_path"),
    edit_repo_file: pick("path") ?? pick("file_path"),
    create_pull_request: pick("title"),
    reload_preview: "",
  };
  const summary =
    salient[name] ??
    pick("summary") ??
    Object.values(args).find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    ) ??
    "";
  return oneLine(summary, 90);
}

function progressFor(state: StreamState, id: string): MessageProgress {
  let progress = state.perMessage.get(id);
  if (!progress) {
    progress = {
      contentLength: 0,
      reasoningLength: 0,
      announcedTools: new Map(),
      settledTools: new Set(),
    };
    state.perMessage.set(id, progress);
  }
  return progress;
}

/**
 * Diff a fresh conversation snapshot against what was already emitted and
 * return the new events. Mutates `state`; otherwise pure — no I/O — so the
 * streaming rules are unit-testable.
 */
export function diffConversation(
  state: StreamState,
  messages: ConversationMessage[],
): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || message.hidden) continue;
    const progress = progressFor(state, message.id);

    const reasoning = message.reasoning?.content ?? "";
    if (reasoning.length > progress.reasoningLength) {
      const delta = reasoning.slice(progress.reasoningLength).trim();
      if (delta) events.push({ kind: "thinking", text: oneLine(delta, 300) });
      progress.reasoningLength = reasoning.length;
    }

    if (
      typeof message.content === "string" &&
      message.content.length > progress.contentLength
    ) {
      const delta = message.content.slice(progress.contentLength).trim();
      if (delta) events.push({ kind: "text", text: delta });
      progress.contentLength = message.content.length;
    }

    for (const tool of message.tool_calls ?? []) {
      if (!progress.announcedTools.has(tool.id)) {
        progress.announcedTools.set(
          tool.id,
          toolSummary(tool.name, tool.arguments_string),
        );
        events.push({
          kind: "tool_start",
          id: tool.id,
          name: tool.name,
          summary: progress.announcedTools.get(tool.id) ?? "",
        });
      }
      const status = tool.status ?? "running";
      if (TOOL_SETTLED.has(status) && !progress.settledTools.has(tool.id)) {
        progress.settledTools.add(tool.id);
        events.push({
          kind: "tool_end",
          id: tool.id,
          name: tool.name,
          summary: progress.announcedTools.get(tool.id) ?? "",
          ok: status === "success",
          result: oneLine(tool.results, 110),
        });
      }
    }
  }
  return events;
}

/**
 * Whether the newest user message's turn has finished. The backend stamps
 * `outcome` onto the turn's user message with backend_status "pending" at turn
 * START and flips it to a terminal value (success_build, error_build,
 * error_backend, stopped, success_no_generation) at end-of-loop — through
 * auto-fix, whose activity we keep streaming meanwhile. Authoritative, unlike
 * the app's status field, which flaps mid-turn.
 */
export function turnSettled(messages: ConversationMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user" && !message.hidden) {
      const outcome = message.outcome as { backend_status?: string } | null;
      return (
        outcome != null &&
        typeof outcome === "object" &&
        outcome.backend_status !== "pending"
      );
    }
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface StreamOptions {
  branchId?: string;
  intervalMs?: number;
}

function makePoller(
  onEvent: (event: StreamEvent) => void,
  options: StreamOptions,
) {
  const state = newStreamState();
  return async (prime = false): Promise<ConversationMessage[]> => {
    try {
      const messages = await getFullConversation(30, options.branchId);
      const events = diffConversation(state, messages);
      if (!prime) for (const event of events) onEvent(event);
      return messages;
    } catch {
      return []; // Transient read failure — the next tick retries.
    }
  };
}

/**
 * Run `start` while live-emitting the conversation it drives. The current
 * snapshot is consumed FIRST (earlier turns are never replayed), then `start`
 * fires, and the conversation is polled until its promise settles — with one
 * final read so nothing between the last tick and settlement is lost.
 * `start`'s result or rejection passes through untouched.
 */
export async function streamConversationDuring<T>(
  start: () => Promise<T>,
  onEvent: (event: StreamEvent) => void,
  options: StreamOptions = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 1_000;
  const poll = makePoller(onEvent, options);
  await poll(true);
  const work = start();
  let pending = true;
  const settled = work.then(
    () => {
      pending = false;
    },
    () => {
      pending = false;
    },
  );
  while (pending) {
    await Promise.race([sleep(intervalMs), settled]);
    if (!pending) break;
    await poll();
  }
  await poll();
  return work;
}

/**
 * Live-emit a turn that is already running server-side (the create kickoff),
 * until its user message carries an outcome — or the deadline passes.
 */
export async function streamConversationUntilSettled(
  onEvent: (event: StreamEvent) => void,
  options: StreamOptions & { timeoutMs?: number } = {},
): Promise<"settled" | "timeout"> {
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000);
  const poll = makePoller(onEvent, options);
  while (Date.now() < deadline) {
    const messages = await poll();
    if (messages.length > 0 && turnSettled(messages)) return "settled";
    await sleep(intervalMs);
  }
  return "timeout";
}
