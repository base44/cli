import { Command } from "commander";
import { log } from "@clack/prompts";
import { pushAgents } from "@core/resources/agent/index.js";
import { readProjectConfig } from "@core/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { agentsPullCommand } from "./pull.js";

async function pushAgentsAction(): Promise<RunCommandResult> {
  const { agents } = await readProjectConfig();

  if (agents.length === 0) {
    return { outroMessage: "No agents found in project" };
  }

  log.info(`Found ${agents.length} agents to push`);

  const result = await runTask(
    "Pushing agents to Base44",
    async () => {
      return await pushAgents(agents);
    },
    {
      successMessage: "Agents pushed successfully",
      errorMessage: "Failed to push agents",
    }
  );

  // Print the results
  if (result.created.length > 0) {
    log.success(`Created: ${result.created.join(", ")}`);
  }
  if (result.updated.length > 0) {
    log.success(`Updated: ${result.updated.join(", ")}`);
  }
  if (result.deleted.length > 0) {
    log.warn(`Deleted: ${result.deleted.join(", ")}`);
  }

  return {};
}

export const agentsCommand = new Command("agents")
  .description("Manage project agents")
  .addCommand(
    new Command("push")
      .description("Push local agents to Base44 (replaces all remote agent configs)")
      .action(async () => {
        await runCommand(pushAgentsAction, { requireAuth: true });
      })
  )
  .addCommand(agentsPullCommand);
