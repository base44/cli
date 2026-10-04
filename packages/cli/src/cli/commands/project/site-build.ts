import { confirm, isCancel } from "@clack/prompts";
import { execa } from "execa";
import type { CLIContext } from "@/cli/types.js";
import { DEFAULT_SITE } from "@/core/project/index.js";
import type { ProjectData } from "@/core/project/types.js";

interface SiteBuildTarget {
  root: string;
  buildCommand?: string;
  appId: string;
}

export async function runSiteBuild(
  { runTask }: Pick<CLIContext, "runTask">,
  { root, buildCommand = DEFAULT_SITE.buildCommand, appId }: SiteBuildTarget,
): Promise<void> {

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
  explicitBuild?: boolean,
): Promise<void> {
  if (!ctx.app) {
    return;
  }

  const shouldBuild =
    explicitBuild ??
    (await maybeAskToBuild(ctx.isNonInteractive, project.site?.buildCommand));
  if (shouldBuild) {
    await runSiteBuild(ctx, {
      root: project.root,
      buildCommand: project.site?.buildCommand,
      appId: ctx.app.id,
    });
  }
}

async function maybeAskToBuild(
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
