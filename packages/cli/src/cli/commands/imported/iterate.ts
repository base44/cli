import { isCancel, text } from "@clack/prompts";
import chalk from "chalk";
import {
  createTurnStream,
  formatDuration,
} from "@/cli/commands/imported/render.js";
import type { CLIContext } from "@/cli/types.js";
import { sendImportedChatMessage } from "@/core/resources/imported/api.js";
import { streamConversationDuring } from "@/core/resources/imported/stream.js";

/**
 * Post-run iteration mode: keep taking prompts and running streamed turns on
 * the same branch until the user submits nothing (or cancels). TTY only —
 * callers gate on interactivity.
 */
export async function runIterationLoop(
  log: CLIContext["log"],
  branchId: string | undefined,
  footer?: string[],
): Promise<void> {
  for (;;) {
    const reply = await text({
      message: "What next? (Enter with no text to finish)",
      placeholder: "e.g. add user login with sessions",
      defaultValue: "",
    });
    if (isCancel(reply) || !String(reply ?? "").trim()) return;

    const turnStartedAt = Date.now();
    const stream = createTurnStream(process.stdout.isTTY === true, undefined, {
      footer,
    });
    let turn: Awaited<ReturnType<typeof sendImportedChatMessage>>;
    try {
      turn = await streamConversationDuring(
        () => sendImportedChatMessage(String(reply).trim(), branchId),
        stream.onEvent,
        { branchId },
      );
    } finally {
      stream.stop();
    }
    if (turn.queued) {
      log.message("Queued behind an earlier message — it will run next.");
      continue;
    }
    const state = turn.status?.state ?? "ready";
    const took = chalk.dim(`· ${formatDuration(Date.now() - turnStartedAt)}`);
    log.message(
      state === "error"
        ? `Turn failed (${turn.status?.error_source ?? "unknown"}) — see the editor for details. ${took}`
        : `Turn finished ${took}`,
    );
  }
}
