import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, formatYaml, YAML_INDENT } from "@/cli/utils/index.js";
import { listAvailableIntegrations } from "@/core/resources/connector/index.js";

async function listAvailableAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
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

  if (jsonMode) {
    return {
      outroMessage: `Found ${integrations.length} available integrations.`,
      stdout: `${JSON.stringify({ integrations }, null, 2)}\n`,
    };
  }

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

export function getConnectorsListAvailableCommand(): Command {
  return new Base44Command("list-available")
    .description("List all available integration types")
    .action(listAvailableAction);
}
