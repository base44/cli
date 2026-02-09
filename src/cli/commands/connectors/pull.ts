import { dirname, join } from "node:path";
import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { readProjectConfig } from "@/core/index.js";
import {
  fetchConnectors,
  writeConnectors,
} from "@/core/resources/connector/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function pullConnectorsAction(): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const connectorsDir = join(configDir, project.connectorsDir);

  const remoteConnectors = await runTask(
    "Fetching connectors from Base44",
    async () => {
      return await fetchConnectors();
    },
    {
      successMessage: "Connectors fetched successfully",
      errorMessage: "Failed to fetch connectors",
    }
  );

  if (remoteConnectors.integrations.length === 0) {
    return { outroMessage: "No connectors found on Base44" };
  }

  const { written, deleted } = await runTask(
    "Writing connector files",
    async () => {
      return await writeConnectors(
        connectorsDir,
        remoteConnectors.integrations
      );
    },
    {
      successMessage: "Connector files written successfully",
      errorMessage: "Failed to write connector files",
    }
  );

  if (written.length > 0) {
    log.success(`Written: ${written.join(", ")}`);
  }
  if (deleted.length > 0) {
    log.warn(`Deleted: ${deleted.join(", ")}`);
  }

  return {
    outroMessage: `Pulled ${remoteConnectors.integrations.length} connectors to ${connectorsDir}`,
  };
}

export function getConnectorsPullCommand(context: CLIContext): Command {
  return new Command("pull")
    .description(
      "Pull connectors from Base44 to local files (replaces all local connector configs)"
    )
    .action(async () => {
      await runCommand(pullConnectorsAction, { requireAuth: true }, context);
    });
}
