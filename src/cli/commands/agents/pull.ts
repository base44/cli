import { join, dirname } from "node:path";
import { Command } from "commander";
import { log } from "@clack/prompts";
import { fetchAgents, writeAgents } from "@core/resources/agent/index.js";
import { readProjectConfig } from "@core/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function pullAgentsAction(): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const agentsDir = join(configDir, project.agentsDir);

  const response = await runTask(
    "Fetching agents from Base44",
    async () => {
      return await fetchAgents();
    },
    {
      successMessage: "Agents fetched successfully",
      errorMessage: "Failed to fetch agents",
    }
  );

  if (response.items.length === 0) {
    return { outroMessage: "No agents found on Base44" };
  }

  const { written, deleted } = await runTask(
    "Writing agent files",
    async () => {
      return await writeAgents(agentsDir, response.items);
    },
    {
      successMessage: "Agent files written successfully",
      errorMessage: "Failed to write agent files",
    }
  );

  if (written.length > 0) {
    log.success(`Written: ${written.join(", ")}`);
  }
  if (deleted.length > 0) {
    log.warn(`Deleted: ${deleted.join(", ")}`);
  }

  return { outroMessage: `Pulled ${response.total} agents to ${agentsDir}` };
}

export const agentsPullCommand = new Command("pull")
  .description("Pull agents from Base44 to local files")
  .action(async () => {
    await runCommand(pullAgentsAction, { requireAuth: true });
  });
