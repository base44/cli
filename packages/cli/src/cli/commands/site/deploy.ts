import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import { addDeploymentOptions } from "@/cli/commands/site/deploy-options.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { ConfigNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import { detectAppDeployKind } from "@/core/site/index.js";
import { runAppSiteDeploy } from "./run-app-deploy.js";

interface DeployOptions {
  yes?: boolean;
  build?: boolean;
  gitHash?: string;
  concurrency?: number;
}

async function deployAction(
  ctx: CLIContext,
  options: DeployOptions,
): Promise<RunCommandResult> {
  const { isNonInteractive } = ctx;
  if (isNonInteractive && !options.yes) {
    throw new InvalidInputError("--yes is required in non-interactive mode");
  }

  const { project } = await readProjectConfig();

  const kind = await detectAppDeployKind(project);

  if (kind === "none") {
    throw new ConfigNotFoundError("No site configuration found.", {
      hints: [
        {
          message:
            'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
        },
        {
          message:
            "Full-stack apps ship from their build artifact — run your framework's build first",
        },
      ],
    });
  }

  if (!options.yes) {
    const shouldDeploy = await confirm({
      message:
        kind === "full-stack"
          ? "Deploy full-stack app?"
          : `Deploy site from ${project.site?.outputDirectory}?`,
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  }

  await maybeBuildBeforeDeploy(ctx, project, options.build);

  const result = await runAppSiteDeploy(ctx, project, {
    gitHash: options.gitHash,
    concurrency: options.concurrency,
  });

  if (result.kind === "full-stack" || result.kind === "static-deployment") {
    // No URL: what production serves is decided when the app is published from
    // the builder, not by this deploy.
    return {
      outroMessage: `Deployment ${result.deploymentId} (commit ${result.gitHash.slice(0, 12)})`,
      stdout: ctx.jsonMode
        ? `${JSON.stringify(
            { deploymentId: result.deploymentId, gitHash: result.gitHash },
            null,
            2,
          )}\n`
        : undefined,
    };
  }

  if (result.kind === "static") {
    return { outroMessage: `Visit your site at: ${result.appUrl}` };
  }

  return { outroMessage: "Nothing to deploy" };
}

export function getSiteDeployCommand(): Command {
  const command = new Base44Command("deploy")
    .description(
      "Deploy the built site to Base44 hosting (full-stack apps deploy their Workers build)",
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--build", "Build the site before deploying (skips the prompt)")
    .option("--no-build", "Deploy without building (skips the prompt)");

  return addDeploymentOptions(command).action(deployAction);
}
