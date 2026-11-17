import { resolve } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { dropSite } from "@/core/site/index.js";

async function dropAction(
  { runTask, jsonMode }: CLIContext,
  dir: string,
): Promise<RunCommandResult> {
  const { appId, appUrl } = await runTask(
    "Creating app and deploying site...",
    async () => await dropSite(resolve(dir)),
    {
      successMessage: theme.colors.base44Orange("Site deployed successfully"),
      errorMessage: "Drop failed",
    },
  );

  return {
    outroMessage: `Visit your site at: ${theme.colors.links(appUrl)}`,
    stdout: jsonMode
      ? `${JSON.stringify({ appId, appUrl }, null, 2)}\n`
      : undefined,
  };
}

export function getDropCommand(): Command {
  return new Base44Command("drop", { requireAppContext: false })
    .description(
      "Host a folder of static files (index.html at its root) on Base44 as a new app",
    )
    .argument("[dir]", "Folder to deploy", ".")
    .action(dropAction);
}
