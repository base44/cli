import { Command } from "commander";
import open from "open";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { ProjectSDK } from "@/core/sdk.js";

async function openAction(sdk: ProjectSDK): Promise<RunCommandResult> {
  const siteUrl = await sdk.site.getUrl();

  if (!process.env.CI) {
    await open(siteUrl);
  }

  return { outroMessage: `Site opened at ${siteUrl}` };
}

export function getSiteOpenCommand(context: CLIContext): Command {
  return new Command("open")
    .description("Open the published site in your browser")
    .action(async () => {
      await runCommand(openAction, { requireAuth: true }, context);
    });
}
