import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppState } from "@/core/resources/apps/api.js";

async function statusAction(ctx: CLIContext): Promise<RunCommandResult> {
  const id = ctx.app?.id as string;
  const app = await ctx.runTask("Reading app status", () => getAppState(id));
  const state = app.status?.state ?? "ready";
  if (ctx.jsonMode) {
    return {
      stdout: `${JSON.stringify({ id: app.id, state, message: app.status?.message ?? null })}\n`,
    };
  }
  ctx.log.message(`State:  ${state}`);
  if (app.status?.message) ctx.log.message(`Note:   ${app.status.message}`);
  return { outroMessage: "Status read." };
}

export function getStatusCommand(): Base44Command {
  const command = new Base44Command("status");
  command
    .description("Show whether the app is building, ready, or errored")
    .action(statusAction);
  return command;
}
