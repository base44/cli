import { resolve, join } from "node:path";
import { execa } from "execa";
import { Command } from "commander";
import { log, group, text, select, confirm, isCancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import kebabCase from "lodash.kebabcase";
import { createProjectFiles, listTemplates, readProjectConfig } from "@core/project/index.js";
import type { Template } from "@core/project/index.js";
import { getBase44ApiUrl, loadProjectEnv } from "@core/config.js";
import { deploySite, pushEntities } from "@core/index.js";
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

  // Set the project ID in the environment variables for following client calls
  await loadProjectEnv();

  log.success(`Dashboard link:\n${chalk.bold(`${getBase44ApiUrl()}/apps/${projectId}/editor/preview`)}`);

  const { project, entities } = await readProjectConfig(resolvedPath);

  // Prompt to push entities if needed
  if (entities.length > 0) {
    const shouldPushEntities = await confirm({
      message: 'Would you like to push entities now?',
    })

    if (!isCancel(shouldPushEntities) && shouldPushEntities) {
      await runTask(
        `Pushing ${entities.length} entities to Base44...`,
        async () => {
          await pushEntities(entities);
        },
        {
          successMessage: "Entities pushed successfully",
          errorMessage: "Failed to push entities",
        }
      );
    }
  }

  // Prompt to install dependencies if needed
  if (project.site) {
    const installCommand = project.site.installCommand;
    const buildCommand = project.site.buildCommand;

    const shouldDeploy = await confirm({
      message: 'Would you like to deploy the site now?'
    })

    if (!isCancel(shouldDeploy) && shouldDeploy && installCommand && buildCommand) {
      await runTask(
        "Installing dependencies...",
        async () => {
          await execa({ cwd: resolvedPath, shell: true })`${installCommand}`;
        },
        {
          successMessage: "Dependencies installed successfully",
          errorMessage: "Failed to install dependencies",
        }
      );

      await runTask(
        "Building project output...",
        async () => {
          await execa({ cwd: resolvedPath, shell: true })`${buildCommand}`;
        },
        {
          successMessage: "Project output built successfully",
          errorMessage: "Failed to build project output",
        }
      );

      const { app_url } = await runTask(
        "Deploying site...",
        async () => {
          return await deploySite(join(resolvedPath, project.site!.outputDirectory!));
        },
        {
          successMessage: "Site deployed successfully",
          errorMessage: "Failed to deploy site",
        }
      );

      log.success(`Visit your site on ${app_url}`);
    }
  }

  log.success(`Project ${chalk.bold(name)} is set and ready to use!`);
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .action(async () => {
    await runCommand(create, { fullBanner: true, requireAuth: true });
  });
