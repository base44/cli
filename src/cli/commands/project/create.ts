import { resolve, join } from "node:path";
import { execa } from "execa";
import { Command } from "commander";
import { log, group, text, select, confirm, intro, outro, isCancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import kebabCase from "lodash.kebabcase";
import { createProjectFiles, listTemplates, readProjectConfig } from "@core/project/index.js";
import type { Template } from "@core/project/index.js";
import { getBase44ApiUrl, loadProjectEnv } from "@core/config.js";
import { deploySite, pushEntities } from "@core/index.js";
import { runCommand, runTask, onPromptCancel } from "../../utils/index.js";

const orange = chalk.hex("#E86B3C");
const cyan = chalk.hex("#00D4FF");

async function create(): Promise<void> {
  intro("Let's create something amazing!");

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
          message: "Pick a template",
          options: templateOptions,
        }),
      name: () =>
        text({
          message: "What is the name of your project?",
          placeholder: "my-app",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Every project deserves a name";
            }
          },
        }),
      description: () =>
        text({
          message: "Description (optional)",
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
    "Setting up your project...",
    async () => {
      return await createProjectFiles({
        name: name.trim(),
        description: description ? description.trim() : undefined,
        path: resolvedPath,
        template,
      });
    },
    {
      successMessage: orange("Project created successfully"),
      errorMessage: "Failed to create project",
    }
  );

  // Set the project ID in the environment variables for following client calls
  await loadProjectEnv();

  const { project, entities } = await readProjectConfig(resolvedPath);
  let appUrl: string | undefined;

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
          successMessage: orange("Entities pushed successfully"),
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
      const { app_url } = await runTask(
        "Installing dependencies...",
        async (updateMessage) => {
          await execa({ cwd: resolvedPath, shell: true })`${installCommand}`;

          updateMessage("Building project...");
          await execa({ cwd: resolvedPath, shell: true })`${buildCommand}`;

          updateMessage("Deploying site...");
          return await deploySite(join(resolvedPath, project.site!.outputDirectory!));
        },
        {
          successMessage: orange("Site deployed successfully"),
          errorMessage: "Failed to deploy site",
        }
      );

      appUrl = app_url;
    }
  }

  const dashboardUrl = `${getBase44ApiUrl()}/apps/${projectId}/editor/preview`;

  log.message(`${chalk.dim("Project")}: ${orange(name.trim())}`);
  log.message(`${chalk.dim("Dashboard")}: ${cyan(dashboardUrl)}`);


  if (appUrl) {
    log.message(`${chalk.dim("Site")}: ${cyan(appUrl)}`);
  }

  outro("Your project is set and ready to use");
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .action(async () => {
    await runCommand(create, { fullBanner: true, requireAuth: true });
  });
