import type { Command } from "commander";
import { runSiteBuild } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";

async function buildAction(ctx: CLIContext): Promise<RunCommandResult> {
  const { app } = ctx;
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 build requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }

  const { project } = await readProjectConfig(app.projectRoot);
  await runSiteBuild(ctx, {
    root: project.root,
    buildCommand: project.site?.buildCommand,
    appId: app.id,
  });

  return {
    outroMessage: `Site built with app id ${theme.styles.bold(app.id)}`,
  };
}

export function getBuildCommand(): Command {
  return new Base44Command("build")
    .description("Build the site with the Base44 app id injected")
    .action(buildAction);
}
