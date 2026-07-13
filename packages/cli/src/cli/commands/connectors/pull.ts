import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { getAppContext } from "@/core/project/index.js";
import {
  pullAllConnectors,
  writeConnectors,
} from "@/core/resources/connector/index.js";

interface PullOptions {
  dir?: string;
}

/**
 * Where to write connector files. When the app context comes from a linked
 * project (.app.jsonc), mirror that project's connectors directory. With an
 * explicit --app-id / BASE44_APP_ID there is no project (no projectRoot), so
 * default to ./connectors (overridable with --dir).
 */
async function resolveConnectorsDir(options: PullOptions): Promise<string> {
  if (!getAppContext().projectRoot) {
    return resolve(options.dir ?? "connectors");
  }
  const { project } = await readProjectConfig();
  return join(dirname(project.configPath), project.connectorsDir);
}

async function pullConnectorsAction(
  { log, runTask, jsonMode }: CLIContext,
  options: PullOptions,
): Promise<RunCommandResult> {
  const connectorsDir = await resolveConnectorsDir(options);

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

  if (jsonMode) {
    return {
      outroMessage: `Pulled ${remoteConnectors.length} connectors to ${connectorsDir}`,
      stdout: `${JSON.stringify(
        { connectorsDir, pulled: remoteConnectors.length, written, deleted },
        null,
        2,
      )}\n`,
    };
  }

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
    .option(
      "--dir <path>",
      "Directory to write connector files to (default: ./connectors when using --app-id)",
    )
    .action(pullConnectorsAction);
}
