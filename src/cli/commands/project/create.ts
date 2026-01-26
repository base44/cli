import { resolve, join, basename } from "node:path";
import { execa } from "execa";
import { Argument, Command } from "commander";
import { log, group, text, select, confirm, isCancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import kebabCase from "lodash.kebabcase";
import { createProjectFiles, listTemplates, readProjectConfig, setAppConfig } from "@/core/project/index.js";
import type { Template } from "@/core/project/index.js";
import { deploySite, isDirEmpty, pushEntities } from "@/core/index.js";
import {
  runCommand,
  runTask,
  onPromptCancel,
  theme,
  getDashboardUrl,
} from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

const DEFAULT_TEMPLATE_ID = "backend-only";

interface CreateOptions {
  name?: string;
  path?: string;
  template?: string;
  deploy?: boolean;
  skills?: boolean;
}

async function getTemplateById(templateId: string): Promise<Template> {
  const templates = await listTemplates();
  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    const validIds = templates.map((t) => t.id).join(", ");
    throw new Error(`Template "${templateId}" not found. Available templates: ${validIds}`);
  }
  return template;
}

function validateNonInteractiveFlags(command: Command): void {
  const { path } = command.opts<CreateOptions>();

  if (path && !command.args.length) {
    command.error("Non-interactive mode requires all flags: --name, --path");
  }
}

async function chooseCreate(options: CreateOptions): Promise<void> {
  const isNonInteractive = !!(options.name && options.path);

  if (isNonInteractive) {
    await runCommand(() => createNonInteractive(options), { requireAuth: true, requireAppConfig: false });
  } else {
    await runCommand(() => createInteractive(options), { fullBanner: true, requireAuth: true, requireAppConfig: false });
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
      name: () => {
        return options.name ? Promise.resolve(options.name) : text({
          message: "What is the name of your project?",
          placeholder: basename(process.cwd()),
          initialValue: basename(process.cwd()),
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Every project deserves a name";
            }
          },
        })
      },
      projectPath: async ({ results }) => {
        const suggestedPath = await isDirEmpty() ? `./` : `./${kebabCase(results.name)}`;
        return text({
          message: "Where should we create your project?",
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
    projectPath: result.projectPath as string,
    deploy: options.deploy,
    skills: options.skills,
    isInteractive: true,
  });
}

async function createNonInteractive(options: CreateOptions): Promise<RunCommandResult> {
  const template = await getTemplateById(options.template ?? DEFAULT_TEMPLATE_ID);

  return await executeCreate({
    template,
    name: options.name!,
    projectPath: options.path!,
    deploy: options.deploy,
    skills: options.skills,
    isInteractive: false,
  });
}

async function executeCreate({
  template,
  name: rawName,
  description,
  projectPath,
  deploy,
  skills,
  isInteractive,
}: {
  template: Template;
  name: string;
  description?: string;
  projectPath: string;
  deploy?: boolean;
  skills?: boolean;
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
      successMessage: theme.colors.base44Orange("Project created successfully"),
      errorMessage: "Failed to create project",
    }
  );

  // Set app config in cache for sync access to getDashboardUrl and getAppClient
  setAppConfig({ id: projectId, projectRoot: resolvedPath });

  const { project, entities } = await readProjectConfig(resolvedPath);
  let finalAppUrl: string | undefined;

  if (entities.length > 0) {
    let shouldPushEntities: boolean;

    if (isInteractive) {
      const result = await confirm({
        message: "Set up the backend data now? (This pushes the data models used by the template to Base44)",
      });
      shouldPushEntities = !isCancel(result) && result;
    } else {
      shouldPushEntities = !!deploy;
    }

    if (shouldPushEntities) {
      await runTask(
        `Pushing ${entities.length} data models to Base44...`,
        async () => {
          await pushEntities(entities);
        },
        {
          successMessage: theme.colors.base44Orange("Data models pushed successfully"),
          errorMessage: "Failed to push data models",
        }
      );
    }
  }

  if (project.site) {
    const { installCommand, buildCommand, outputDirectory } = project.site;

    let shouldDeploy: boolean;

    if (isInteractive) {
      const result = await confirm({
        message: "Would you like to deploy the site now? (Hosted on Base44)",
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
          successMessage: theme.colors.base44Orange("Site deployed successfully"),
          errorMessage: "Failed to deploy site",
        }
      );

      finalAppUrl = appUrl;
    }
  }

  // Add AI agent skills
  const shouldAddSkills = skills ?? true;

  if (shouldAddSkills) {
    try {
      await runTask(
        "Installing AI agent skills...",
        async () => {
          await execa("npx", ["-y", "add-skill", "base44/skills", "-y"], {
            cwd: resolvedPath,
            shell: true
          });
        },
        {
          successMessage: theme.colors.base44Orange("AI agent skills added successfully"),
          errorMessage: "Failed to add AI agent skills - you can add them later with: npx add-skill base44/skills",
        }
      );
    } catch {
      // Skills installation is non-critical (e.g., user may not have git installed)
      // The error message is already shown by runTask, so we just continue
    }
  }

  log.message(`${theme.styles.header("Project")}: ${theme.colors.base44Orange(name)}`);
  log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(projectId))}`);

  if (finalAppUrl) {
    log.message(`${theme.styles.header("Site")}: ${theme.colors.links(finalAppUrl)}`);
  }

  return { outroMessage: "Your project is set up and ready to use" };
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .addArgument(new Argument('name', 'Project name').argOptional())
  .option("-p, --path <path>", "Path where to create the project")
  .option("-t, --template <id>", "Template ID (e.g., backend-only, backend-and-client)")
  .option("--deploy", "Build and deploy the site")
  .option("--skills", "Add AI agent skills")
  .hook("preAction", validateNonInteractiveFlags)
  .action(async (name: string | undefined, options: CreateOptions) => {
    await chooseCreate({ name, ...options });
  });
