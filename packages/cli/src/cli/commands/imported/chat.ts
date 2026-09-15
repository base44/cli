import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import type { ImportedChatTurn } from "@/core/resources/imported/api.js";
import { sendImportedChatMessage } from "@/core/resources/imported/api.js";

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

async function chatAction(
  { log, runTask, jsonMode }: CLIContext,
  message: string,
): Promise<RunCommandResult> {
  const turn = await runTask("Agent working (a turn can take minutes)", () =>
    sendImportedChatMessage(message),
  );

  if (turn.queued) {
    const note =
      "The agent is busy with an earlier message — yours was queued and will run next.";
    if (jsonMode) return { stdout: `${JSON.stringify({ queued: true })}\n` };
    return { outroMessage: note };
  }

  const state = turn.status?.state ?? "ready";
  const reply = lastAssistantReply(turn);
  if (jsonMode) {
    return {
      stdout: `${JSON.stringify({
        status: state,
        error_source: turn.status?.error_source ?? null,
        reply: reply ?? null,
      })}\n`,
    };
  }

  if (reply) log.message(reply);
  if (state === "error") {
    return {
      outroMessage: `Turn failed (${turn.status?.error_source ?? "unknown"}) — see the editor for details.`,
    };
  }
  return { outroMessage: "Turn finished." };
}

export function getImportedChatCommand(): Base44Command {
  const command = new Base44Command("chat");
  command
    .description("Send a message to the app's agent and wait for the turn")
    .argument("<message>", "What you want the agent to do")
    .action(chatAction);
  return command;
}
