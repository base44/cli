import { resolve } from "node:path";
import { Command } from "commander";
import { confirm, isCancel } from "@clack/prompts";
import { readProjectConfig } from "@core/project/index.js";
import { deploySite } from "@core/site/index.js";
import { runCommand, runTask, isJsonMode } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

interface DeployOptions {
  yes?: boolean;
}

/**
 * JSON output result for the site deploy command.
 */
interface SiteDeployResult {
  /** The public URL where the site is hosted. */
  appUrl?: string;
  /** True if the deployment was cancelled by the user. */
  cancelled?: boolean;
}

async function deployAction(options: DeployOptions): Promise<RunCommandResult<SiteDeployResult>> {
  const { project } = await readProjectConfig();

  if (!project.site?.outputDirectory) {
    throw new Error(
      "No site configuration found. Please add 'site.outputDirectory' to your config.jsonc"
    );
  }

  const outputDir = resolve(project.root, project.site.outputDirectory);

  // Skip confirmation in JSON mode (no interactive prompts) or with --yes flag
  if (!options.yes && !isJsonMode()) {
    const shouldDeploy = await confirm({
      message: `Deploy site from ${project.site.outputDirectory}?`,
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return {
        outroMessage: "Deployment cancelled",
        data: { cancelled: true },
      };
    }
  }

  const result = await runTask(
    "Creating archive and deploying site...",
    async () => {
      return await deploySite(outputDir);
    },
    {
      successMessage: "Site deployed successfully",
      errorMessage: "Deployment failed",
    }
  );

  return {
    outroMessage: `Visit your site at: ${result.appUrl}`,
    data: {
      appUrl: result.appUrl,
    },
  };
}

export const siteDeployCommand = new Command("site")
  .description("Manage site deployments")
  .addCommand(
    new Command("deploy")
      .description("Deploy built site files to Base44 hosting")
      .option("-y, --yes", "Skip confirmation prompt")
      .action(async (options: DeployOptions) => {
        await runCommand(() => deployAction(options), { requireAuth: true });
      })
  );
