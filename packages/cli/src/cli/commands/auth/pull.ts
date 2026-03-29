import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  pullAuthConfig,
  writeAuthConfig,
} from "@/core/resources/auth-config/index.js";

async function pullAuthAction({ log }: CLIContext): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  const remoteConfig = await runTask(
    "Fetching auth config from Base44",
    async () => {
      return await pullAuthConfig();
    },
    {
      successMessage: "Auth config fetched successfully",
      errorMessage: "Failed to fetch auth config",
    },
  );

  const { written } = await runTask(
    "Syncing auth config file",
    async () => {
      return await writeAuthConfig(authDir, remoteConfig);
    },
    {
      successMessage: "Auth config file synced successfully",
      errorMessage: "Failed to sync auth config file",
    },
  );

  if (written) {
    log.success("Auth config written to local file");
  } else {
    log.info("Auth config is already up to date");
  }

  return {
    outroMessage: `Pulled auth config to ${authDir} (overwrites local file)`,
  };
}

export function getAuthPullCommand(): Command {
  return new Base44Command("pull")
    .description("Pull auth config from Base44 to local file")
    .action(pullAuthAction);
}
