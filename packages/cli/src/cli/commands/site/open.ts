import type { Command } from "commander";
import open from "open";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getSiteUrl } from "@/core/site/index.js";

async function openAction(
  isNonInteractive: boolean,
): Promise<RunCommandResult> {
  const siteUrl = await getSiteUrl();

  if (!isNonInteractive) {
    await open(siteUrl);
  }

  return { outroMessage: `Site opened at ${siteUrl}` };
}

export function getSiteOpenCommand(): Command {
  return new Base44Command("open")
    .description("Open the published site in your browser")
    .action(async (_options: unknown, command: Base44Command) => {
      return await openAction(command.isNonInteractive);
    });
}
