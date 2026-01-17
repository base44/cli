import { resolve } from "node:path";
import { log, confirm, isCancel } from "@clack/prompts";
import { BaseCommand } from "../../lib/base-command.js";
import { runTask } from "../../lib/run-task.js";
import { readProjectConfig } from "../../../core/project/index.js";
import { deploySite } from "../../../core/site/index.js";

export default class SiteDeploy extends BaseCommand {
  static override description = "Deploy built site files to Base44 hosting";
  static override examples = ["<%= config.bin %> site deploy"];

  async run(): Promise<void> {
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
}
