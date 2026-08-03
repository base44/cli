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
  if (!ctx.app || !project.site?.outputDirectory) {
    return;
  }

  const shouldBuild = await shouldBuildBeforeDeploy({
    build,
    isNonInteractive: ctx.isNonInteractive,
    buildCommand: project.site.buildCommand,
  });
  if (shouldBuild) {
    await runSiteBuild(ctx, {
      root: project.root,
      buildCommand: project.site.buildCommand,
      appId: ctx.app.id,
    });
  }
}

interface BuildBeforeDeployChoice {
  build?: boolean;
  isNonInteractive: boolean;
  buildCommand?: string;
}

async function shouldBuildBeforeDeploy({
  build,
  isNonInteractive,
  buildCommand,
}: BuildBeforeDeployChoice): Promise<boolean> {
  if (!buildCommand) {
    return false;
  }
  if (build !== undefined) {
    return build;
  }
  if (isNonInteractive) {
    return false;
  }
  const answer = await confirm({
    message: `Build the site first? (runs '${buildCommand}' with your app id)`,
  });
  return !isCancel(answer) && answer;
}
