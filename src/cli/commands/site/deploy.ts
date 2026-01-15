import { resolve } from "node:path";
import { Command } from "commander";
import { log, confirm, isCancel } from "@clack/prompts";
import { readProjectConfig } from "@core/project/index.js";
import { deploySite } from "@core/site/index.js";
import { runCommand, runTask } from "../../utils/index.js";

async function deployAction(): Promise<void> {
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
    log.warn("Deployment cancelled");
    return;
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

  log.success(`Site deployed to: ${result.app_url}`);
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
