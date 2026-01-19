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
const DEFAULT_TEMPLATE_ID = "backend-only";

interface CreateOptions {
  name?: string;
  description?: string;
  path?: string;
  deploy?: boolean;
}

async function getDefaultTemplate(): Promise<Template> {
  const templates = await listTemplates();
  const template = templates.find((t) => t.id === DEFAULT_TEMPLATE_ID);
  if (!template) {
    throw new Error(`Default template "${DEFAULT_TEMPLATE_ID}" not found`);
  }
  return template;
}

function validateNonInteractiveFlags(command: Command): void {
  const { name, path } = command.opts<CreateOptions>();
  const providedCount = [name, path].filter(Boolean).length;

  if (providedCount > 0 && providedCount < 2) {
    command.error("Non-interactive mode requires all flags: --name, --path");
  }
}

async function chooseCreate(options: CreateOptions): Promise<void> {
  const isNonInteractive = !!(options.name && options.path);

  if (isNonInteractive) {
    await runCommand(() => createNonInteractive(options), { requireAuth: true });
  } else {
    await runCommand(() => createInteractive(options), { fullBanner: true, requireAuth: true });
  }
}

async function createInteractive(options: CreateOptions): Promise<RunCommandResult> {
  const templates = await listTemplates();
  const templateOptions: Array<Option<Template>> = templates.map((t) => ({
    value: t,
    label: t.name,
    hint: t.description,
  }));

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

  return await executeCreate({
    template: result.template,
    name: result.name,
    description: result.description || undefined,
    projectPath: result.projectPath as string,
    deploy: options.deploy,
    isInteractive: true,
  });
}

async function createNonInteractive(options: CreateOptions): Promise<RunCommandResult> {
  const template = await getDefaultTemplate();

  return await executeCreate({
    template,
    name: options.name!,
    description: options.description,
    projectPath: options.path!,
    deploy: options.deploy,
    isInteractive: false,
  });
}

async function executeCreate({
  template,
  name: rawName,
  description,
  projectPath,
  deploy,
  isInteractive,
}: {
  template: Template;
  name: string;
  description?: string;
  projectPath: string;
  deploy?: boolean;
  isInteractive: boolean;
}): Promise<RunCommandResult> {
  const name = rawName.trim();
  const resolvedPath = resolve(projectPath);

  const { projectId } = await runTask(
    "Setting up your project...",
    async () => {
      return await createProjectFiles({
        name,
        description: description?.trim(),
        path: resolvedPath,
        template,
      });
    },
    {
      successMessage: orange("Project created successfully"),
      errorMessage: "Failed to create project",
    }
  );

  await loadProjectEnv(resolvedPath);

  const { project, entities } = await readProjectConfig(resolvedPath);
  let finalAppUrl: string | undefined;

  if (entities.length > 0) {
    let shouldPushEntities: boolean;

    if (isInteractive) {
      const result = await confirm({
        message: "Would you like to push entities now?",
      });
      shouldPushEntities = !isCancel(result) && result;
    } else {
      shouldPushEntities = !!deploy;
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

  if (project.site) {
    const { installCommand, buildCommand, outputDirectory } = project.site;

    let shouldDeploy: boolean;

    if (isInteractive) {
      const result = await confirm({
        message: "Would you like to deploy the site now?",
      });
      shouldDeploy = !isCancel(result) && result;
    } else {
      shouldDeploy = !!deploy;
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

  log.message(`${chalk.dim("Project")}: ${orange(name)}`);
  log.message(`${chalk.dim("Dashboard")}: ${cyan(dashboardUrl)}`);

  if (finalAppUrl) {
    log.message(`${chalk.dim("Site")}: ${cyan(finalAppUrl)}`);
  }

  return { outroMessage: "Your project is set and ready to use" };
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .option("-n, --name <name>", "Project name")
  .option("-d, --description <description>", "Project description")
  .option("-p, --path <path>", "Path where to create the project")
  .option("--deploy", "Build and deploy the site")
  .hook("preAction", validateNonInteractiveFlags)
  .action(async (options: CreateOptions) => {
    await chooseCreate(options);
  });
