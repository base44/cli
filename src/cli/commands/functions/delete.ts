import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { ApiError } from "@/core/errors.js";
import { deleteSingleFunction } from "@/core/resources/function/api.js";

async function deleteFunctionAction(
  name: string,
): Promise<RunCommandResult> {
  try {
    await deleteSingleFunction(name);
    log.success(`${name} deleted`);
    return { outroMessage: `Function "${name}" deleted` };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      log.warn(`Function "${name}" not found on remote`);
      return { outroMessage: `Function "${name}" not found` };
    }
    throw error;
  }
}

export function getDeleteCommand(context: CLIContext): Command {
  return new Command("delete")
    .description("Delete a deployed backend function")
    .argument("<name>", "Name of the function to delete")
    .action(async (name: string) => {
      await runCommand(
        () => deleteFunctionAction(name),
        { requireAuth: true },
        context,
      );
    });
}
