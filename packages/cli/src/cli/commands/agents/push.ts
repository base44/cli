import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { pushAgents } from "@/core/resources/agent/index.js";

async function pushAgentsAction({
  logger,
}: CLIContext): Promise<RunCommandResult> {
  const { agents } = await readProjectConfig();

  logger.info(
    agents.length === 0
      ? "No local agents found - this will delete all remote agents"
      : `Found ${agents.length} agents to push`,
  );

  const result = await runTask(
    "Pushing agents to Base44",
    async () => {
      return await pushAgents(agents);
    },
    {
      successMessage: "Agents pushed successfully",
      errorMessage: "Failed to push agents",
    },
  );

  if (result.created.length > 0) {
    logger.success(`Created: ${result.created.join(", ")}`);
  }
  if (result.updated.length > 0) {
    logger.success(`Updated: ${result.updated.join(", ")}`);
  }
  if (result.deleted.length > 0) {
    logger.warn(`Deleted: ${result.deleted.join(", ")}`);
  }

  return { outroMessage: "Agents pushed to Base44" };
}

export function getAgentsPushCommand(): Command {
  return new Base44Command("push")
    .description(
      "Push local agents to Base44 (replaces all remote agent configs)",
    )
    .action(pushAgentsAction);
}
