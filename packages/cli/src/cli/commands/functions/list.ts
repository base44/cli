import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { listDeployedFunctions } from "@/core/resources/function/api.js";

async function listFunctionsAction(): Promise<RunCommandResult> {
  const { functions } = await listDeployedFunctions();

  if (functions.length === 0) {
    return { outroMessage: "No functions on remote" };
  }

  for (const fn of functions) {
    const autoCount = fn.automations.length;
    const autoLabel =
      autoCount > 0
        ? theme.styles.dim(
            ` (${autoCount} automation${autoCount > 1 ? "s" : ""})`,
          )
        : "";
    log.message(`  ${fn.name}${autoLabel}`);
  }

  return {
    outroMessage: `${functions.length} function${functions.length !== 1 ? "s" : ""} on remote`,
  };
}

export function getListCommand(context: CLIContext): Command {
  return new Command("list")
    .description("List all deployed functions")
    .action(async () => {
      await runCommand(listFunctionsAction, { requireAuth: true }, context);
    });
}
