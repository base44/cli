import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { listSecrets } from "@/core/resources/secret/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function listSecretsAction(): Promise<RunCommandResult> {
  const secrets = await runTask(
    "Fetching secrets from Base44",
    async () => {
      return await listSecrets();
    },
    {
      successMessage: "Secrets fetched successfully",
      errorMessage: "Failed to fetch secrets",
    },
  );

  const names = Object.keys(secrets);

  if (names.length === 0) {
    return { outroMessage: "No secrets configured." };
  }

  for (const name of names) {
    log.info(name);
  }

  return {
    outroMessage: `Found ${names.length} secrets.`,
  };
}

export function getSecretsListCommand(context: CLIContext): Command {
  return new Command("list")
    .description("List secret names")
    .action(async () => {
      await runCommand(listSecretsAction, { requireAuth: true }, context);
    });
}
