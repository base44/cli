import { dirname, join } from "node:path";
import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { readProjectConfig } from "@/core/index.js";
import { fetchAgents, writeAgents } from "@/core/resources/agent/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function pullAgentsAction(): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const agentsDir = join(configDir, project.agentsDir);

  const remoteAgents = await runTask(
    "Fetching agents from Base44",
    async () => {
      return await fetchAgents();
    },
    {
      successMessage: "Agents fetched successfully",
      errorMessage: "Failed to fetch agents",
    },
  );

  const { written, deleted } = await runTask(
    "Syncing agent files",
    async () => {
      return await writeAgents(agentsDir, remoteAgents.items);
    },
    {
      successMessage: "Agent files synced successfully",
      errorMessage: "Failed to sync agent files",
    },
  );

  if (written.length > 0) {
    log.success(`Written: ${written.join(", ")}`);
  }
  if (deleted.length > 0) {
    log.warn(`Deleted: ${deleted.join(", ")}`);
  }
  if (written.length === 0 && deleted.length === 0) {
    log.info("All agents are already up to date");
  }

  return {
    outroMessage: `Pulled ${remoteAgents.total} agents to ${agentsDir}`,
  };
}

export function getAgentsPullCommand(context: CLIContext): Command {
  return new Command("pull")
    .description(
      "Pull agents from Base44 to local files (replaces all local agent configs)",
    )
    .action(async () => {
      await runCommand(pullAgentsAction, { requireAuth: true }, context);
    });
}
