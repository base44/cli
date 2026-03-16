import { resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { ConfigNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import { deploySite } from "@/core/site/index.js";

interface DeployOptions {
  yes?: boolean;
  isNonInteractive?: boolean;
}

async function deployAction(options: DeployOptions): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  if (!project.site?.outputDirectory) {
    throw new ConfigNotFoundError("No site configuration found.", {
      hints: [
        {
          message:
            'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
        },
      ],
    });
  }

  const outputDir = resolve(project.root, project.site.outputDirectory);

  if (!options.yes) {
    const shouldDeploy = await confirm({
      message: `Deploy site from ${project.site.outputDirectory}?`,
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
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
    },
  );

  return { outroMessage: `Visit your site at: ${result.appUrl}` };
}

export function getSiteDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy built site files to Base44 hosting")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options: DeployOptions, command: Base44Command) => {
      if (command.isNonInteractive && !options.yes) {
        throw new InvalidInputError(
          "--yes is required in non-interactive mode",
        );
      }
      return await deployAction({
        ...options,
        isNonInteractive: command.isNonInteractive,
      });
    });
}
