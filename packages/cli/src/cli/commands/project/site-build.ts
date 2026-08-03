import { confirm, isCancel } from "@clack/prompts";
import { execa } from "execa";
import type { CLIContext } from "@/cli/types.js";
import { ConfigNotFoundError } from "@/core/errors.js";
import type { ProjectData } from "@/core/project/types.js";

interface SiteBuildTarget {
  root: string;
  buildCommand?: string;
  appId: string;
}

export async function runSiteBuild(
  { runTask }: Pick<CLIContext, "runTask">,
  { root, buildCommand, appId }: SiteBuildTarget,
): Promise<void> {
  if (!buildCommand) {
    throw new ConfigNotFoundError("No site build command found.", {
      hints: [
        {
          message:
            'Add \'site.buildCommand\' to your config.jsonc (e.g., "site": { "buildCommand": "npm run build" })',
        },
      ],
    });
  }

  await runTask(
    "Building site...",
    () =>
      execa({
        cwd: root,
        shell: true,
        env: { VITE_BASE44_APP_ID: appId },
      })`${buildCommand}`,
    {
      successMessage: "Site built successfully",
      errorMessage: "Build failed",
    },
  );
}

export async function maybeBuildBeforeDeploy(
  ctx: Pick<CLIContext, "runTask" | "isNonInteractive" | "app">,
  project: ProjectData["project"],
  build?: boolean,
): Promise<void> {
  if (!ctx.app) {
    return;
  }

  // An explicit --build must be loud when there is nothing to build:
  // runSiteBuild throws ConfigNotFoundError when buildCommand is missing.
  if (build === true) {
    await runSiteBuild(ctx, {
      root: project.root,
      buildCommand: project.site?.buildCommand,
      appId: ctx.app.id,
    });
    return;
  }

  if (build === false || !project.site?.outputDirectory) {
    return;
  }

  const shouldBuild = await shouldAskToBuild(
    ctx.isNonInteractive,
    project.site.buildCommand,
  );
  if (shouldBuild) {
    await runSiteBuild(ctx, {
      root: project.root,
      buildCommand: project.site.buildCommand,
      appId: ctx.app.id,
    });
  }
}

async function shouldAskToBuild(
  isNonInteractive: boolean,
  buildCommand?: string,
): Promise<boolean> {
  if (!buildCommand || isNonInteractive) {
    return false;
  }
  const answer = await confirm({
    message: `Build the site first? (runs '${buildCommand}' with your app id)`,
  });
  return !isCancel(answer) && answer;
}
