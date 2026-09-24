import { resolveBranchId } from "@/cli/commands/builder/shared.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { stopTurn } from "@/core/resources/apps/api.js";

async function stopAction(ctx: CLIContext): Promise<RunCommandResult> {
  const branchId = await resolveBranchId(ctx);
  await ctx.runTask("Stopping the running turn", () => stopTurn(branchId));
  if (ctx.jsonMode) return { stdout: `${JSON.stringify({ stopped: true })}\n` };
  return { outroMessage: "Stopped." };
}

export function getStopCommand(): Base44Command {
  const command = new Base44Command("stop", { supportsBranch: true });
  command.description("Stop the agent's running turn").action(stopAction);
  return command;
}
