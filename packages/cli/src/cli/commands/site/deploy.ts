import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { Option } from "commander";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { ConfigNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import { runAppSiteDeploy } from "./run-app-deploy.js";

interface DeployOptions {
  yes?: boolean;
  build?: boolean;
  gitHash?: string;
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

  const outputDirectory = project.site?.outputDirectory;

  if (!outputDirectory) {
    throw new ConfigNotFoundError("No site configuration found.", {
      hints: [
        {
          message:
            'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
        },
      ],
    });
  }

  if (!options.yes) {
    const shouldDeploy = await confirm({
      message: `Deploy site from ${outputDirectory}?`,
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  }

  await maybeBuildBeforeDeploy(ctx, project, options.build);

  const result = await runAppSiteDeploy(ctx, project, {
    gitHash: options.gitHash,
  });

  if (result.kind === "static-deployment") {
    // A build has no URL of its own: what production serves is decided when
    // the app is published from the builder, not by this deploy.
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

export function getSiteDeployCommand(staticDeployments = false): Command {
  const command = new Base44Command("deploy")
    .description("Deploy built site files to Base44 hosting")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--build", "Build the site before deploying (skips the prompt)")
    .option("--no-build", "Deploy without building (skips the prompt)");

  // `--git-hash` addresses a deployments-API deploy by the commit that produced
  // the build, so it only means anything on that lane — and that lane is
  // internal until the server side ships. Registering it only when the lane is
  // on keeps it out of `--help` and makes it an unknown option otherwise, as if
  // it did not exist. This is the command the build sandbox drives, so it is
  // the only one that exposes the override.
  if (staticDeployments) {
    command.addOption(
      new Option(
        "--git-hash <hash>",
        "Commit the build came from (defaults to the checkout's HEAD)",
      ),
    );
  }

  return command.action(deployAction);
}
