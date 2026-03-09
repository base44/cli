import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import {
  formatYaml,
  runCommand,
  runTask,
  YAML_INDENT,
} from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { listAvailableIntegrations } from "@/core/resources/connector/index.js";

async function listAvailableAction(): Promise<RunCommandResult> {
  const { integrations } = await runTask(
    "Fetching available integrations from Base44",
    async () => {
      return await listAvailableIntegrations();
    },
    {
      successMessage: "Available integrations fetched successfully",
      errorMessage: "Failed to fetch available integrations",
    },
  );

  if (integrations.length === 0) {
    return { outroMessage: "No available integrations found." };
  }

  for (const { displayName, ...rest } of integrations) {
    const yaml = formatYaml(rest);
    const pad = " ".repeat(YAML_INDENT);
    log.info(`${displayName}\n${pad}${yaml.replace(/\n/g, `\n${pad}`)}`);
  }

  return {
    outroMessage: `Found ${integrations.length} available integrations.`,
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
