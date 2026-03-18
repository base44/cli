import { log } from "@clack/prompts";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { listSecrets } from "@/core/resources/secret/index.js";

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

export function getSecretsListCommand(): Command {
  return new Base44Command("list")
    .description("List secret names")
    .action(listSecretsAction);
}
