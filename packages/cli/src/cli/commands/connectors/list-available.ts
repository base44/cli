import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { listAvailableIntegrations } from "@/core/resources/connector/index.js";

async function listAvailableAction(): Promise<RunCommandResult> {
  const { availableIntegrations } = await runTask(
    "Fetching available integrations from Base44",
    async () => {
      return await listAvailableIntegrations();
    },
    {
      successMessage: "Available integrations fetched successfully",
      errorMessage: "Failed to fetch available integrations",
    },
  );

  if (availableIntegrations.length === 0) {
    return { outroMessage: "No available integrations found." };
  }

  for (const integration of availableIntegrations) {
    log.info(
      `${theme.styles.bold(integration.displayName)} ${theme.styles.dim(`(${integration.integrationType})`)}${integration.description ? `\n  ${theme.styles.dim(integration.description)}` : ""}`,
    );
  }

  return {
    outroMessage: `Found ${availableIntegrations.length} available integrations.`,
  };
}

export function getConnectorsListAvailableCommand(
  context: CLIContext,
): Command {
  return new Command("list-available")
    .description("List all available integration types")
    .action(async () => {
      await runCommand(listAvailableAction, { requireAuth: true }, context);
    });
}
