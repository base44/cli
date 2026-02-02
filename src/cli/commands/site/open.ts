import { Command } from "commander";
import open from "open";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import { getSiteUrl } from "@/core/site/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function openAction(): Promise<RunCommandResult> {
  const siteUrl = await getSiteUrl();

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
