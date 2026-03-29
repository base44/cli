import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  hasAnyLoginMethod,
  pushAuthConfig,
} from "@/core/resources/auth-config/index.js";

interface PushAuthOptions {
  yes?: boolean;
}

async function pushAuthAction(
  { isNonInteractive, log }: CLIContext,
  options: PushAuthOptions,
): Promise<RunCommandResult> {
  const { authConfig } = await readProjectConfig();

  if (authConfig.length === 0) {
    log.info("No local auth config found");
    return {
      outroMessage:
        "No auth config to push. Run `base44 auth pull` to fetch the remote config first.",
    };
  }

  if (!hasAnyLoginMethod(authConfig[0])) {
    log.warn(
      "This config has no login methods enabled. Pushing it will lock out all users.",
    );
  }

  if (!options.yes) {
    if (isNonInteractive) {
      throw new InvalidInputError("--yes is required in non-interactive mode");
    }

    const shouldPush = await confirm({
      message: "Push auth config to Base44?",
    });

    if (isCancel(shouldPush) || !shouldPush) {
      return { outroMessage: "Push cancelled" };
    }
  }

  await runTask(
    "Pushing auth config to Base44",
    async () => {
      return await pushAuthConfig(authConfig[0] ?? null);
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
    .option("-y, --yes", "Skip confirmation prompt")
    .action(pushAuthAction);
}
