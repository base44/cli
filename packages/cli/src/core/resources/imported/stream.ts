import type { ConversationMessage } from "@/core/resources/imported/api.js";
import { getFullConversation } from "@/core/resources/imported/api.js";

interface MessageProgress {
  contentLength: number;
  reasoningLength: number;
  announcedTools: Set<string>;
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

function progressFor(state: StreamState, id: string): MessageProgress {
  let progress = state.perMessage.get(id);
  if (!progress) {
    progress = {
      contentLength: 0,
      reasoningLength: 0,
      announcedTools: new Set(),
      settledTools: new Set(),
    };
    state.perMessage.set(id, progress);
  }
  return progress;
}

/**
 * Diff a fresh conversation snapshot against what was already shown and return
 * the new lines to print. Mutates `state`. Pure aside from that — no I/O — so
 * the rendering rules are unit-testable.
 */
export function renderConversationDelta(
  state: StreamState,
  messages: ConversationMessage[],
): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || message.hidden) continue;
    const progress = progressFor(state, message.id);

    const reasoning = message.reasoning?.content ?? "";
    if (reasoning.length > progress.reasoningLength) {
      const delta = reasoning.slice(progress.reasoningLength).trim();
      if (delta) lines.push(`✻ ${oneLine(delta, 300)}`);
      progress.reasoningLength = reasoning.length;
    }

    if (
      typeof message.content === "string" &&
      message.content.length > progress.contentLength
    ) {
      const delta = message.content.slice(progress.contentLength).trim();
      if (delta) lines.push(delta);
      progress.contentLength = message.content.length;
    }

    for (const tool of message.tool_calls ?? []) {
      if (!progress.announcedTools.has(tool.id)) {
        progress.announcedTools.add(tool.id);
        const args = oneLine(tool.arguments_string ?? "", 110);
        lines.push(`→ ${tool.name}${args ? `  ${args}` : ""}`);
      }
      const status = tool.status ?? "running";
      if (TOOL_SETTLED.has(status) && !progress.settledTools.has(tool.id)) {
        progress.settledTools.add(tool.id);
        const mark = status === "success" ? "✓" : "✗";
        const result = oneLine(tool.results, 140);
        lines.push(`${mark} ${tool.name}${result ? ` — ${result}` : ""}`);
      }
    }
  }
  return lines;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `start` while live-printing the conversation it drives.
 *
 * The current snapshot is consumed FIRST (so earlier turns are never
 * replayed), then `start` fires, and the conversation is polled until its
 * promise settles — with one final read so nothing between the last tick and
 * settlement is lost. Poll failures are skipped (transient); `start`'s result
 * or rejection passes through untouched.
 */
export async function streamConversationDuring<T>(
  start: () => Promise<T>,
  print: (line: string) => void,
  options: { branchId?: string; intervalMs?: number } = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 2_000;
  const state = newStreamState();

  const poll = async (prime = false) => {
    try {
      const messages = await getFullConversation(30, options.branchId);
      const lines = renderConversationDelta(state, messages);
      if (!prime) for (const line of lines) print(line);
    } catch {
      // Transient read failure — the next tick retries.
    }
  };

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
