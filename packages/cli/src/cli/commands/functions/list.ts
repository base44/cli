import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask, theme } from "@/cli/utils/index.js";
import type { Logger } from "@/cli/utils/logger/types.js";
import { listDeployedFunctions } from "@/core/resources/function/api.js";

async function listFunctionsAction(logger: Logger): Promise<RunCommandResult> {
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
    logger.message(`  ${fn.name}${automationLabel}`);
  }

  return {
    outroMessage: `${functions.length} function${functions.length !== 1 ? "s" : ""} on remote`,
  };
}

export function getListCommand(): Command {
  return new Base44Command("list")
    .description("List all deployed functions")
    .action((_options: unknown, command: Base44Command) =>
      listFunctionsAction(command.logger),
    );
}
