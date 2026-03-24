import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { deleteSecret } from "@/core/resources/secret/index.js";

async function deleteSecretAction(
  { runTask }: CLIContext,
  key: string,
): Promise<RunCommandResult> {
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

export function getSecretsDeleteCommand(): Command {
  return new Base44Command("delete")
    .description("Delete a secret")
    .argument("<key>", "Secret name to delete")
    .action(deleteSecretAction);
}
