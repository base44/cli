import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { listDeployedFunctions } from "@/core/resources/function/api.js";

async function listFunctionsAction(): Promise<RunCommandResult> {
  const { functions } = await runTask(
    "Fetching functions...",
    async () => listDeployedFunctions(),
    { errorMessage: "Failed to fetch functions" },
  );

  if (functions.length === 0) {
    return { outroMessage: "No functions on remote" };
  }

  for (const fn of functions) {
    const automationCount = fn.automations.length;
    const automationLabel =
      automationCount > 0
        ? theme.styles.dim(
            ` (${automationCount} automation${automationCount > 1 ? "s" : ""})`,
          )
        : "";
    log.message(`  ${fn.name}${automationLabel}`);
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
