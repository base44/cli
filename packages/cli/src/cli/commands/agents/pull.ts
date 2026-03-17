import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import type { Logger } from "@/cli/utils/logger/types.js";
import { readProjectConfig } from "@/core/index.js";
import { fetchAgents, writeAgents } from "@/core/resources/agent/index.js";

async function pullAgentsAction(logger: Logger): Promise<RunCommandResult> {
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
    logger.success(`Written: ${written.join(", ")}`);
  }
  if (deleted.length > 0) {
    logger.warn(`Deleted: ${deleted.join(", ")}`);
  }
  if (written.length === 0 && deleted.length === 0) {
    logger.info("All agents are already up to date");
  }

  return {
    outroMessage: `Pulled ${remoteAgents.total} agents to ${agentsDir}`,
  };
}

export function getAgentsPullCommand(): Command {
  return new Base44Command("pull")
    .description(
      "Pull agents from Base44 to local files (replaces all local agent configs)",
    )
    .action((_options: unknown, command: Base44Command) =>
      pullAgentsAction(command.logger),
    );
}
