import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { log, group, text, select, confirm, isCancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import kebabCase from "lodash.kebabcase";
import { createProjectFiles, listTemplates, readProjectConfig } from "@core/project/index.js";
import type { Template } from "@core/project/index.js";
import { getBase44ApiUrl } from "@core/config.js";
import { deploySite } from "@core/site/index.js";
import { runCommand, runTask, onPromptCancel } from "../../utils/index.js";

async function create(): Promise<void> {
  const templates = await listTemplates();
  const templateOptions: Array<Option<Template>> = templates.map((t) => ({
    value: t,
    label: t.name,
    hint: t.description,
  }));

  const { template, name, description, projectPath } = await group(
    {
      template: () =>
        select({
          message: "Select a project template",
          options: templateOptions,
        }),
      name: () =>
        text({
          message: "What is the name of your project?",
          placeholder: "my-app-backend",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Project name is required";
            }
          },
        }),
      description: () =>
        text({
          message: "Project description (optional)",
          placeholder: "A brief description of your project",
        }),
      projectPath: async ({ results }) => {
        const suggestedPath = `./${kebabCase(results.name)}`;
        return text({
          message: "Where should we create the base44 folder?",
          placeholder: suggestedPath,
          initialValue: suggestedPath,
        });
      },
    },
    {
      onCancel: onPromptCancel,
    }
  );

  const resolvedPath = resolve(projectPath as string);

  // Create the project
  const { projectId } = await runTask(
    "Creating project...",
    async () => {
      return await createProjectFiles({
        name: name.trim(),
        description: description ? description.trim() : undefined,
        path: resolvedPath,
        template,
      });
    },
    {
      successMessage: "Project created successfully",
      errorMessage: "Failed to create project",
    }
  );

  log.success(`Project ${chalk.bold(name)} has been initialized!`);
  log.success(`Dashboard link:\n${chalk.bold(`${getBase44ApiUrl()}/apps/${projectId}/editor/preview`)}`);

  // Check if project has site configuration and offer to deploy
  try {
    const { project } = await readProjectConfig(resolvedPath);
    if (project.site?.buildCommand && project.site?.outputDirectory) {
      const shouldDeploy = await confirm({
        message: "Would you like to deploy your site now?",
      });

      if (!isCancel(shouldDeploy) && shouldDeploy) {
        // Build the project
        await runTask(
          "Building project...",
          async () => {
            execSync(project.site!.buildCommand!, {
              cwd: resolvedPath,
              stdio: "pipe",
            });
          },
          {
            successMessage: "Build completed",
            errorMessage: "Build failed",
          }
        );

        // Deploy the site
        const outputDir = resolve(resolvedPath, project.site.outputDirectory);
        const result = await runTask(
          "Deploying site...",
          async () => {
            return await deploySite(outputDir);
          },
          {
            successMessage: "Site deployed successfully",
            errorMessage: "Deployment failed",
          }
        );

        log.success(`Site deployed to: ${chalk.bold(result.app_url)}`);
      }
    }
  } catch {
    // No site config or deployment not available - skip silently
  }
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .action(async () => {
    await runCommand(create, { fullBanner: true, requireAuth: true });
  });
