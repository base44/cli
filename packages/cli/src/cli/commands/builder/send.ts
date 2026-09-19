import {
  type AnswerFlags,
  assertBuilderApp,
  buildAnswer,
  hasAnswer,
  pendingSummary,
  resolveBranchId,
} from "@/cli/commands/builder/shared.js";
import { createTurnStream } from "@/cli/commands/code/render.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import type { ChatTurn } from "@/core/resources/apps/api.js";
import {
  answerToolCall,
  getFullConversation,
  sendTurn,
} from "@/core/resources/apps/api.js";
import {
  type PendingInput,
  pendingInputs,
} from "@/core/resources/apps/pending.js";
import {
  type StreamEvent,
  streamConversationDuring,
} from "@/core/resources/apps/stream.js";

function lastAssistantReply(turn: ChatTurn): string | undefined {
  const messages = turn.conversation?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const { role, content } = messages[i];
    if (role === "assistant" && typeof content === "string" && content.trim()) {
      return content.trim();
    }
  }
  return undefined;
}

interface SendOptions extends AnswerFlags {
  verbose?: boolean;
  streamJson?: boolean;
  autoApprove?: boolean;
  skipQuestions?: boolean;
}

/** One JSON object per line: every stream event as it lands, then `result`. */
export function ndjsonWriter(): (record: Record<string, unknown>) => void {
  return (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The result envelope every caller reads: what happened, and — when the
 * builder parked a call — what it is asking, so the next `send` can answer. */
function turnResult(
  turn: ChatTurn,
  pending: PendingInput[],
): Record<string, unknown> {
  if (turn.queued) return { queued: true };
  const base = {
    status: pending.length ? "waiting" : (turn.status?.state ?? "ready"),
    error_source: turn.status?.error_source ?? null,
    reply: lastAssistantReply(turn) ?? null,
  };
  return pending.length ? { ...base, pending: pendingSummary(pending) } : base;
}

/** Policy for scripts: approve approval-kind pauses (granting every requested
 * permission), skip questions so the builder decides. Never secrets, never
 * browser steps, never unknown forms — those always come back as waiting. */
export async function applyPolicy(
  pending: PendingInput[],
  options: { autoApprove?: boolean; skipQuestions?: boolean },
  branchId: string | undefined,
  onEvent: (event: StreamEvent) => void,
): Promise<PendingInput[]> {
  let current = pending;
  for (let round = 0; round < 10 && current.length; round++) {
    const target = current.find(
      (p) =>
        (options.autoApprove &&
          (p.kind === "approval" || p.kind === "permissions")) ||
        (options.skipQuestions && p.kind === "choice"),
    );
    if (!target) break;
    const input =
      target.kind === "permissions"
        ? {
            approved_permission_keys: (target.permissions ?? []).map(
              (p) => p.key,
            ),
          }
        : target.kind === "choice"
          ? { answers: [] }
          : {};
    await streamConversationDuring(
      () =>
        answerToolCall(
          {
            toolCallId: target.toolCallId,
            messageId: target.messageId,
            action: "approved",
            input,
          },
          branchId,
        ),
      onEvent,
      { branchId },
    );
    current = pendingInputs(await getFullConversation(30, branchId));
  }
  return current;
}

async function sendAction(
  ctx: CLIContext,
  message: string | undefined,
  options: SendOptions,
): Promise<RunCommandResult> {
  if (options.streamJson && ctx.jsonMode) {
    throw new InvalidInputError("--stream-json and --json are exclusive.");
  }
  const answering = hasAnswer(options);
  if (answering && message) {
    throw new InvalidInputError(
      "Either send a message or answer the pending question (--approve / --choose / …), not both.",
    );
  }
  if (!answering && !message) {
    throw new InvalidInputError(
      'Send a message ("<message>") or answer what the agent asked (--approve, --reject, --choose, --grant, --secret, --skip, --input).',
    );
  }
  if (ctx.app) await assertBuilderApp(ctx.app.id);
  const branchId = await resolveBranchId(ctx);

  // What the builder is waiting on, before we do anything. A failed read must
  // not block a message: treat it as "nothing pending" and let the send proceed.
  const pendingBefore = pendingInputs(
    await getFullConversation(30, branchId).catch(() => []),
  );
  let start: () => Promise<ChatTurn>;
  if (answering) {
    if (pendingBefore.length === 0) {
      throw new InvalidInputError(
        "Nothing is waiting for an answer — send a message instead.",
      );
    }
    const target = options.id
      ? pendingBefore.find((p) => p.toolCallId === options.id)
      : pendingBefore.length === 1
        ? pendingBefore[0]
        : undefined;
    if (!target) {
      throw new InvalidInputError(
        options.id
          ? `No pending call with id ${options.id}. Pending: ${pendingBefore.map((p) => p.toolCallId).join(", ")}.`
          : `Several calls are waiting — pick one with --id: ${pendingBefore.map((p) => `${p.toolCallId} (${p.kind}: ${p.title})`).join("; ")}.`,
      );
    }
    const answer = await buildAnswer(target, options, readStdin);
    start = () =>
      answerToolCall(
        {
          toolCallId: target.toolCallId,
          messageId: target.messageId,
          action: answer.action,
          input: answer.input,
        },
        branchId,
      );
  } else {
    if (pendingBefore.length) {
      // The backend refuses a message while a call is parked; say what is
      // blocking instead of surfacing that as a bare 4xx.
      const record = {
        status: "waiting",
        pending: pendingSummary(pendingBefore),
      };
      if (options.streamJson) {
        ndjsonWriter()({ type: "result", ...record });
        return {};
      }
      if (ctx.jsonMode) return { stdout: `${JSON.stringify(record)}\n` };
      throw new InvalidInputError(
        `The agent is waiting on you before it can take a message: ${pendingBefore.map((p) => `${p.title} (${p.kind})`).join("; ")}. Answer with --approve / --choose / --grant / --secret, or --reject.`,
      );
    }
    const text = message as string;
    start = () => sendTurn(text, branchId);
  }

  const finish = async (
    turn: ChatTurn,
    onEvent: (event: StreamEvent) => void,
  ): Promise<Record<string, unknown>> => {
    let pending = turn.queued
      ? []
      : pendingInputs(await getFullConversation(30, branchId).catch(() => []));
    if (pending.length && (options.autoApprove || options.skipQuestions)) {
      pending = await applyPolicy(pending, options, branchId, onEvent);
    }
    return turnResult(turn, pending);
  };

  if (options.streamJson) {
    const write = ndjsonWriter();
    const onEvent = ({ kind, ...event }: StreamEvent) =>
      write({ type: kind, ...event });
    const turn = await streamConversationDuring(start, onEvent, { branchId });
    const result = await finish(turn, onEvent);
    write({ type: "result", queued: result.queued === true, ...result });
    return {};
  }

  if (ctx.jsonMode) {
    const turn = await ctx.runTask(
      "Agent working (a turn can take minutes)",
      start,
    );
    return {
      stdout: `${JSON.stringify(await finish(turn, () => undefined))}\n`,
    };
  }

  const stream = createTurnStream(process.stdout.isTTY === true, undefined, {
    verbose: options.verbose,
  });
  let result: Record<string, unknown>;
  try {
    const turn = await streamConversationDuring(start, stream.onEvent, {
      branchId,
    });
    result = await finish(turn, stream.onEvent);
  } finally {
    stream.stop();
  }
  if (result.queued === true) {
    return {
      outroMessage:
        "The agent is busy with an earlier message — yours was queued and runs next.",
    };
  }
  if (result.status === "waiting") {
    for (const p of result.pending as Record<string, unknown>[]) {
      ctx.log.message(`  ⏸ ${p.title} (${p.kind})`);
    }
    return {
      outroMessage:
        "The agent is waiting on you. Answer with `base44 builder send --approve` (or --choose, --grant, --secret, --reject), or open `base44 code`.",
    };
  }
  if (result.status === "error") {
    return {
      outroMessage:
        result.error_source === "paywall"
          ? "The workspace is out of credits — nothing ran."
          : `Turn failed (${result.error_source ?? "unknown"}) — see the editor for details.`,
    };
  }
  return { outroMessage: "Turn finished." };
}

const collect = (v: string, acc: string[] = []) => [...acc, v];

export function getSendCommand(): Base44Command {
  const command = new Base44Command("send", { supportsBranch: true });
  command
    .description(
      'Send the agent one message and stream the turn until it finishes — or answer what it asked (--approve, --choose, …). A result with status "waiting" lists what the agent needs; the next send answers it.',
    )
    .argument("[message]", "What you want the agent to do")
    .option("--approve", "Approve the pending call (permissions: grant all)")
    .option("--reject", "Reject the pending call")
    .option("--skip", "Skip the pending questions; the agent decides")
    .option(
      "--choose <label>",
      "Answer a question by option label; repeat per question, comma-separate for multi-select",
      collect,
    )
    .option("--other <text>", "Free-text answer for the last question")
    .option("--grant <keys>", "Permission keys to grant, comma-separated")
    .option(
      "--secret <NAME=source>",
      "A requested secret from env:VAR, file:PATH or - (stdin); repeat per secret",
      collect,
    )
    .option("--input <json>", "Raw extra_user_input for the pending call")
    .option(
      "--id <tool-call-id>",
      "Which pending call to answer when several wait",
    )
    .option(
      "--auto-approve",
      "Policy: approve approval-kind pauses (never secrets or browser steps)",
    )
    .option(
      "--skip-questions",
      "Policy: skip clarifying questions; the agent decides",
    )
    .option("--verbose", "Show every tool result in full (no folding)")
    .option(
      "--stream-json",
      "Emit each stream event as a JSON line as it happens, then a final result line",
    )
    .action(sendAction);
  return command;
}
