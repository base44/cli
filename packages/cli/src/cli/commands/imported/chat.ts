import chalk from "chalk";
import { createTurnStream } from "@/cli/commands/imported/render.js";
import { runInteractiveSession } from "@/cli/commands/imported/session.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { getAppContext } from "@/core/project/app-config.js";
import type { ImportedChatTurn } from "@/core/resources/imported/api.js";
import {
  sendImportedChatMessage,
  soleActiveBranchId,
} from "@/core/resources/imported/api.js";
import { streamConversationDuring } from "@/core/resources/imported/stream.js";

function lastAssistantReply(turn: ImportedChatTurn): string | undefined {
  const messages = turn.conversation?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return undefined;
}

function chatFooter(): string[] {
  try {
    const editorUrl = `${getBase44ApiUrl()}/apps/${getAppContext().id}/editor/preview`;
    return [chalk.dim(`editor  ${editorUrl}`)];
  } catch {
    return [];
  }
}

function turnOutro(turn: ImportedChatTurn): string {
  const state = turn.status?.state ?? "ready";
  if (state === "error") {
    return `Turn failed (${turn.status?.error_source ?? "unknown"}) — see the editor for details.`;
  }
  return "Turn finished.";
}

async function chatAction(
  { log, runTask, jsonMode, branchId: explicitBranchId }: CLIContext,
  message: string,
): Promise<RunCommandResult> {
  // Messages must land on the app's working branch: an unscoped send goes to
  // the main line, whose sandbox is separate and never pushed.
  const branchId =
    explicitBranchId ?? (await soleActiveBranchId().catch(() => undefined));

  if (jsonMode) {
    const turn = await runTask("Agent working (a turn can take minutes)", () =>
      sendImportedChatMessage(message, branchId),
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

  if (process.stdout.isTTY !== true) {
    const stream = createTurnStream(false);
    let turn: ImportedChatTurn;
    try {
      turn = await streamConversationDuring(
        () => sendImportedChatMessage(message, branchId),
        stream.onEvent,
        { branchId },
      );
    } finally {
      stream.stop();
    }
    if (turn.queued) {
      return {
        outroMessage:
          "The agent is busy with an earlier message — yours was queued and will run next.",
      };
    }
    return { outroMessage: turnOutro(turn) };
  }

  await runInteractiveSession({
    branchId,
    footer: chatFooter(),
    primeFirstPoll: true,
    initialMessage: message,
  });
  return { outroMessage: "Done." };
}

export function getImportedChatCommand(): Base44Command {
  const command = new Base44Command("chat", { supportsBranch: true });
  command
    .description(
      "Open an interactive agent session on the app, starting with this message",
    )
    .argument("<message>", "What you want the agent to do")
    .action(chatAction);
  return command;
}
