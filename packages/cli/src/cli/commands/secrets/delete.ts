import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { deleteSecret } from "@/core/resources/secret/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function deleteSecretAction(key: string): Promise<RunCommandResult> {
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

  return {
    outroMessage: "Secret deleted successfully.",
  };
}

export function getSecretsDeleteCommand(context: CLIContext): Command {
  return new Command("delete")
    .description("Delete a secret")
    .argument("<key>", "Secret name to delete")
    .action(async (key: string) => {
      await runCommand(
        () => deleteSecretAction(key),
        { requireAuth: true },
        context,
      );
    });
}
