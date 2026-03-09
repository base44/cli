import { log } from "@clack/prompts";
import { Command } from "commander";
import { stringify } from "yaml";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
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

  for (const i of integrations) {
    const data: Record<string, unknown> = {
      type: i.integrationType,
      description: i.description,
    };
    if (i.connectionConfigFields.length > 0) {
      data.connectionConfigFields = i.connectionConfigFields.map((f) => {
        const field: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(f)) {
          if (v != null) field[k] = v;
        }
        return field;
      });
    }
    const yaml = stringify(data, { indent: 2 }).trimEnd();
    log.info(`${i.displayName}\n  ${yaml.replace(/\n/g, "\n  ")}`);
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
