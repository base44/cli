import {
  assertBuilderApp,
  resolveBranchId,
} from "@/cli/commands/builder/shared.js";
import { createTurnStream } from "@/cli/commands/code/render.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import type { ChatTurn } from "@/core/resources/apps/api.js";
import { sendTurn } from "@/core/resources/apps/api.js";
import { streamConversationDuring } from "@/core/resources/apps/stream.js";

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

interface SendOptions {
  verbose?: boolean;
  streamJson?: boolean;
}

/** One JSON object per line: every stream event as it lands, then `result`. */
export function ndjsonWriter(): (record: Record<string, unknown>) => void {
  return (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function sendAction(
  ctx: CLIContext,
  message: string,
  options: SendOptions,
): Promise<RunCommandResult> {
  if (options.streamJson && ctx.jsonMode) {
    throw new InvalidInputError("--stream-json and --json are exclusive.");
  }
  if (ctx.app) await assertBuilderApp(ctx.app.id);
  const branchId = await resolveBranchId(ctx);

  if (options.streamJson) {
    const write = ndjsonWriter();
    const turn = await streamConversationDuring(
      () => sendTurn(message, branchId),
      ({ kind, ...event }) => write({ type: kind, ...event }),
      { branchId },
    );
    write({
      type: "result",
      queued: turn.queued === true,
      status: turn.status?.state ?? "ready",
      error_source: turn.status?.error_source ?? null,
      reply: lastAssistantReply(turn) ?? null,
    });
    return {};
  }

  if (ctx.jsonMode) {
    const turn = await ctx.runTask(
      "Agent working (a turn can take minutes)",
      () => sendTurn(message, branchId),
    );
    if (turn.queued) return { stdout: `${JSON.stringify({ queued: true })}\n` };
    return {
      stdout: `${JSON.stringify({
        status: turn.status?.state ?? "ready",
        error_source: turn.status?.error_source ?? null,
        reply: lastAssistantReply(turn) ?? null,
      })}\n`,
    };
  }

  const stream = createTurnStream(process.stdout.isTTY === true, undefined, {
    verbose: options.verbose,
  });
  let turn: ChatTurn;
  try {
    turn = await streamConversationDuring(
      () => sendTurn(message, branchId),
      stream.onEvent,
      { branchId },
    );
  } finally {
    stream.stop();
  }
  if (turn.queued) {
    return {
      outroMessage:
        "The agent is busy with an earlier message — yours was queued and runs next.",
    };
  }
  if (turn.status?.state === "error") {
    return {
      outroMessage: `Turn failed (${turn.status.error_source ?? "unknown"}) — see the editor for details.`,
    };
  }
  return { outroMessage: "Turn finished." };
}

export function getSendCommand(): Base44Command {
  const command = new Base44Command("send", { supportsBranch: true });
  command
    .description(
      "Send the agent one message and stream the turn until it finishes",
    )
    .argument("<message>", "What you want the agent to do")
    .option("--verbose", "Show every tool result in full (no folding)")
    .option(
      "--stream-json",
      "Emit each stream event as a JSON line as it happens, then a final result line",
    )
    .action(sendAction);
  return command;
}
