import { resolve } from "node:path";
import { Command } from "commander";
import { confirm, isCancel } from "@clack/prompts";
import { readProjectConfig } from "@core/project/index.js";
import { deploySite } from "@core/site/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function deployAction(): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  if (!project.site?.outputDirectory) {
    throw new Error(
      "No site configuration found. Please add 'site.outputDirectory' to your config.jsonc"
    );
  }

  const outputDir = resolve(project.root, project.site.outputDirectory);

  const shouldDeploy = await confirm({
    message: `Deploy site from ${project.site.outputDirectory}?`,
  });

  if (isCancel(shouldDeploy) || !shouldDeploy) {
    return { outroMessage: "Deployment cancelled" };
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

  return { outroMessage: `Visit your site at: ${result.appUrl}` };
}

export const siteDeployCommand = new Command("site")
  .description("Manage site deployments")
  .addCommand(
    new Command("deploy")
      .description("Deploy built site files to Base44 hosting")
      .action(async () => {
        await runCommand(deployAction, { requireAuth: true });
      })
  );
