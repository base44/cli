import type { Command } from "commander";
import { runSiteBuild } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { resolvePublishTarget } from "@/core/version/index.js";

async function buildAction(ctx: CLIContext): Promise<RunCommandResult> {
  const { app } = ctx;
  // Not readProjectConfig: a Builder repo carries no CLI config, and this is the
  // step a publish sandbox runs inside one. A present config still wins.
  const target = await resolvePublishTarget(app?.projectRoot);

  await runSiteBuild(ctx, {
    root: target.root,
    buildCommand: target.buildCommand,
    appId: app?.id ?? "",
  });

  return {
    outroMessage: `Site built with app id ${theme.styles.bold(app?.id ?? "")}`,
  };
}

export function getBuildCommand(): Command {
  // No credential: it calls no API, and a publish sandbox runs it before minting
  // a key that can deploy. The app id is still required.
  return new Base44Command("build", { requireAuth: false })
    .description("Build the site with the Base44 app id injected")
    .action(buildAction);
}
