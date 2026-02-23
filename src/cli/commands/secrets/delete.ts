import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { deleteSecret } from "@/core/resources/secret/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function deleteSecretsAction(keys: string[]): Promise<RunCommandResult> {
  for (const key of keys) {
    await runTask(
      `Deleting secret "${key}"`,
      async () => {
        return await deleteSecret(key);
      },
      {
        successMessage: `Secret "${key}" deleted`,
        errorMessage: `Failed to delete secret "${key}"`,
      },
    );
  }

  log.info(`Deleted: ${keys.join(", ")}`);

  return {
    outroMessage:
      "Secrets deleted. Your app will automatically redeploy with the updated values.",
  };
}

export function getSecretsDeleteCommand(context: CLIContext): Command {
  return new Command("delete")
    .description("Delete one or more secrets")
    .argument("<keys...>", "Secret name(s) to delete")
    .action(async (keys: string[]) => {
      await runCommand(
        () => deleteSecretsAction(keys),
        { requireAuth: true },
        context,
      );
    });
}
