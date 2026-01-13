import { resolve } from "node:path";
import { Command } from "commander";
import { log, confirm, isCancel } from "@clack/prompts";
import { readProjectConfig } from "@core/project/index.js";
import { deploySite } from "@core/site/index.js";
import { runCommand, runTask } from "../../utils/index.js";

async function deployAction(): Promise<void> {
  // 1. Load project config
  const { project } = await readProjectConfig();

  // 2. Validate site configuration exists
  if (!project.site?.outputDirectory) {
    log.error(
      "No site configuration found. Please add a 'site.outputDirectory' to your config.jsonc"
    );
    process.exit(1);
  }

  const outputDir = resolve(project.root, project.site.outputDirectory);

  // 3. Confirm with user
  const shouldDeploy = await confirm({
    message: `Deploy site from ${project.site.outputDirectory}?`,
  });

  if (isCancel(shouldDeploy) || !shouldDeploy) {
    log.warn("Deployment cancelled");
    process.exit(0);
  }

  // 4. Deploy to Base44
  const result = await runTask(
    "Deploying site...",
    async () => {
      return await deploySite(outputDir);
    },
    {
      successMessage: "Site deployed successfully",
      errorMessage: "Failed to deploy site",
    }
  );

  // 5. Display the deployed URL
  log.success(`Site deployed to: ${result.url}`);
}

export const siteDeployCommand = new Command("site")
  .description("Manage site deployments")
  .addCommand(
    new Command("deploy")
      .description("Deploy built site files to Base44 hosting")
      .action(async () => {
        await runCommand(deployAction);
      })
  );
