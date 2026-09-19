import {
  pendingSummary,
  resolveBranchId,
} from "@/cli/commands/builder/shared.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppState, getFullConversation } from "@/core/resources/apps/api.js";
import { pendingInputs } from "@/core/resources/apps/pending.js";

async function statusAction(ctx: CLIContext): Promise<RunCommandResult> {
  const id = ctx.app?.id as string;
  const branchId = await resolveBranchId(ctx);
  const [app, messages] = await ctx.runTask("Reading app status", () =>
    Promise.all([
      getAppState(id),
      getFullConversation(30, branchId).catch(() => []),
    ]),
  );
  const pending = pendingInputs(messages);
  const state = pending.length ? "waiting" : (app.status?.state ?? "ready");
  if (ctx.jsonMode) {
    return {
      stdout: `${JSON.stringify({
        id: app.id,
        state,
        message: app.status?.message ?? null,
        ...(pending.length ? { pending: pendingSummary(pending) } : {}),
      })}\n`,
    };
  }
  ctx.log.message(`State:  ${state}`);
  if (app.status?.message) ctx.log.message(`Note:   ${app.status.message}`);
  for (const p of pending) ctx.log.message(`  ⏸ ${p.title} (${p.kind})`);
  return {
    outroMessage: pending.length
      ? "The agent is waiting on you — `base44 builder send --approve` (or --choose, --grant, --secret) answers it."
      : "Status read.",
  };
}

export function getStatusCommand(): Base44Command {
  const command = new Base44Command("status", { supportsBranch: true });
  command
    .description(
      "Show whether the app is building, ready, errored — or waiting on you, and for what",
    )
    .action(statusAction);
  return command;
}
