import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import {
  pullAllConnectors,
  writeConnectors,
} from "@/core/resources/connector/index.js";

async function pullConnectorsAction({
  log,
}: CLIContext): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const connectorsDir = join(configDir, project.connectorsDir);

  const remoteConnectors = await runTask(
    "Fetching connectors from Base44",
    async () => {
      return await pullAllConnectors();
    },
    {
      successMessage: "Connectors fetched successfully",
      errorMessage: "Failed to fetch connectors",
    },
  );

  const { written, deleted } = await runTask(
    "Syncing connector files",
    async () => {
      return await writeConnectors(connectorsDir, remoteConnectors);
    },
    {
      successMessage: "Connector files synced successfully",
      errorMessage: "Failed to sync connector files",
    },
  );

  if (written.length > 0) {
    log.success(`Written: ${written.join(", ")}`);
  }
  if (deleted.length > 0) {
    log.warn(`Deleted: ${deleted.join(", ")}`);
  }
  if (written.length === 0 && deleted.length === 0) {
    log.info("All connectors are already up to date");
  }

  return {
    outroMessage: `Pulled ${remoteConnectors.length} connectors to ${connectorsDir}`,
  };
}

export function getConnectorsPullCommand(): Command {
  return new Base44Command("pull")
    .description(
      "Pull connectors from Base44 to local files (replaces all local connector configs)",
    )
    .action(pullConnectorsAction);
}
