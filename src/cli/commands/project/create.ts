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
import type { RunCommandResult } from "../../utils/runCommand.js";

const orange = chalk.hex("#E86B3C");
const cyan = chalk.hex("#00D4FF");

interface CreateOptions {
  template?: string;
  name?: string;
  description?: string;
  path?: string;
  deploy?: boolean;
}

async function create(options: CreateOptions): Promise<RunCommandResult> {
  const templates = await listTemplates();
  const templateOptions: Array<Option<Template>> = templates.map((t) => ({
    value: t,
    label: t.name,
    hint: t.description,
  }));

  // Use provided options or prompt interactively
  let template: Template;
  let name: string;
  let description: string | undefined;
  let projectPath: string;

  if (options.template && options.name) {
    // Non-interactive mode
    const foundTemplate = templates.find((t) => t.name === options.template);
    if (!foundTemplate) {
      throw new Error(
        `Template "${options.template}" not found. Available templates: ${templates.map((t) => t.name).join(", ")}`
      );
    }

    if (!options.name || options.name.trim().length === 0) {
      throw new Error("Project name is required");
    }

    template = foundTemplate;
    name = options.name;
    description = options.description;
    projectPath = options.path || `./${kebabCase(options.name)}`;
  } else {
    // Interactive mode
    const result = await group(
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

    template = result.template as Template;
    name = result.name as string;
    description = result.description as string | undefined;
    projectPath = result.projectPath as string;
  }

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
  await loadProjectEnv(resolvedPath);

  const { project, entities } = await readProjectConfig(resolvedPath);
  let finalAppUrl: string | undefined;

  // Prompt to push entities if needed
  if (entities.length > 0) {
    let shouldPushEntities: boolean;

    if (options.template && options.name) {
      // Non-interactive mode: push entities only if --deploy flag is specified
      shouldPushEntities = options.deploy === true;
    } else {
      // Interactive mode: prompt the user
      const result = await confirm({
        message: 'Would you like to push entities now?',
      });
      shouldPushEntities = !isCancel(result) && result;
    }

    if (shouldPushEntities) {
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
    const outputDirectory = project.site.outputDirectory;

    let shouldDeploy: boolean;

    if (options.template && options.name) {
      // Non-interactive mode: deploy only if --deploy flag is specified
      shouldDeploy = options.deploy === true;
    } else {
      // Interactive mode: prompt the user
      const result = await confirm({
        message: 'Would you like to deploy the site now?'
      });
      shouldDeploy = !isCancel(result) && result;
    }

    if (shouldDeploy && installCommand && buildCommand && outputDirectory) {
      const { appUrl } = await runTask(
        "Installing dependencies...",
        async (updateMessage) => {
          await execa({ cwd: resolvedPath, shell: true })`${installCommand}`;

          updateMessage("Building project...");
          await execa({ cwd: resolvedPath, shell: true })`${buildCommand}`;

          updateMessage("Deploying site...");
          return await deploySite(join(resolvedPath, outputDirectory));
        },
        {
          successMessage: orange("Site deployed successfully"),
          errorMessage: "Failed to deploy site",
        }
      );

      finalAppUrl = appUrl;
    }
  }

  const dashboardUrl = `${getBase44ApiUrl()}/apps/${projectId}/editor/preview`;

  log.message(`${chalk.dim("Project")}: ${orange(name.trim())}`);
  log.message(`${chalk.dim("Dashboard")}: ${cyan(dashboardUrl)}`);


  if (finalAppUrl) {
    log.message(`${chalk.dim("Site")}: ${cyan(finalAppUrl)}`);
  }

  return { outroMessage: "Your project is set and ready to use" };
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .option("-t, --template <template>", "Template to use")
  .option("-n, --name <name>", "Project name")
  .option("-d, --description <description>", "Project description")
  .option("-p, --path <path>", "Path where to create the project")
  .option("--deploy", "Build and deploy the site (includes pushing entities)")
  .action(async (options: CreateOptions) => {
    const isNonInteractive = !!(options.template && options.name);
    await runCommand(() => create(options), { fullBanner: !isNonInteractive, requireAuth: true });
  });
