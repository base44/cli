import { log } from "@clack/prompts";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/project/index.js";
import { pushAuthConfig } from "@/core/resources/auth-config/index.js";

async function pushAuthAction(): Promise<RunCommandResult> {
  const { authConfig } = await readProjectConfig();

  if (authConfig.length === 0) {
    log.info("No local auth config found");
    return {
      outroMessage:
        "No auth config to push. Run `base44 auth pull` to fetch the remote config first.",
    };
  }

  await runTask(
    "Pushing auth config to Base44",
    async () => {
      return await pushAuthConfig(authConfig);
    },
    {
      successMessage: "Auth config pushed successfully",
      errorMessage: "Failed to push auth config",
    },
  );

  return {
    outroMessage: "Auth config pushed to Base44",
  };
}

export function getAuthPushCommand(): Command {
  return new Base44Command("push")
    .description("Push local auth config to Base44")
    .action(pushAuthAction);
}
