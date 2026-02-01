import { Command } from "commander";
import open from "open";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, getSiteUrl } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function browseAction(): Promise<RunCommandResult> {
  const siteUrl = await getSiteUrl();

  if (!process.env.CI) {
    await open(siteUrl);
  }

  return { outroMessage: `Site opened at ${siteUrl}` };
}

export function getSiteBrowseCommand(context: CLIContext): Command {
  return new Command("browse")
    .description("Open the published site in your browser")
    .action(async () => {
      await runCommand(browseAction, { requireAuth: true }, context);
    });
}
