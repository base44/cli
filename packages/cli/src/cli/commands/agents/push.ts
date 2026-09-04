import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, confirmPush, toJsonStdout } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import { pushAgents } from "@/core/resources/agent/index.js";
import { pathExists } from "@/core/utils/fs.js";

interface PushOptions {
  yes?: boolean;
}

async function pushAgentsAction(
  { isNonInteractive, jsonMode, log, runTask }: CLIContext,
  options: PushOptions,
): Promise<RunCommandResult> {
  const { project, agents } = await readProjectConfig();

  if (agents.length === 0) {
    // Reading the agents directory yields an empty list both when the
    // directory is missing and when it exists with no agent files in it. Only
    // the second is a deliberate "remove every agent"; a missing directory
    // usually means the command is running against the wrong project, so
    // refuse instead of wiping the app's agents.
    const agentsDir = join(dirname(project.configPath), project.agentsDir);
    if (!(await pathExists(agentsDir))) {
      throw new InvalidInputError(
        `No agents directory found at "${project.agentsDir}"`,
        {
          hints: [
            {
              message: `Run 'base44 agents pull' to fetch the app's agents, or create an empty "${project.agentsDir}" directory to confirm you want every remote agent deleted`,
            },
          ],
        },
      );
    }
  }

  log.info(
    agents.length === 0
      ? "No local agents found - this will delete all remote agents"
      : `Found ${agents.length} agents to push`,
  );

  const proceed = await confirmPush({
    isNonInteractive,
    yes: options.yes,
    log,
    warning:
      "This will replace all remote agent configs with your local agents and delete any not present locally.",
  });
  if (!proceed) {
    return { outroMessage: "Push cancelled" };
  }

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
    log.success(`Created: ${result.created.join(", ")}`);
  }
  if (result.updated.length > 0) {
    log.success(`Updated: ${result.updated.join(", ")}`);
  }
  if (result.deleted.length > 0) {
    log.warn(`Deleted: ${result.deleted.join(", ")}`);
  }

  if (jsonMode) {
    return {
      outroMessage: "Agents pushed to Base44",
      stdout: toJsonStdout(result),
    };
  }

  return { outroMessage: "Agents pushed to Base44" };
}

export function getAgentsPushCommand(): Command {
  return new Base44Command("push")
    .description(
      "Push local agents to Base44 (replaces all remote agent configs)",
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(pushAgentsAction);
}
