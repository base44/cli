import { basename, join, resolve } from "node:path";
import type { Logger } from "@base44-cli/logger";
import type { Option } from "@clack/prompts";
import { confirm, group, isCancel, select, text } from "@clack/prompts";
import { Argument, type Command } from "commander";
import { execa } from "execa";
import kebabCase from "lodash/kebabCase";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  getDashboardUrl,
  onPromptCancel,
  runTask,
  theme,
} from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { deploySite, isDirEmpty, pushEntities } from "@/core/index.js";
import type { Template } from "@/core/project/index.js";
import {
  createProjectFiles,
  listTemplates,
  readProjectConfig,
  setAppConfig,
} from "@/core/project/index.js";

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
    throw new InvalidInputError(`Template "${templateId}" not found.`, {
      hints: [{ message: `Use one of: ${validIds}` }],
    });
  }
  return template;
}

function validateNonInteractiveFlags(command: Command): void {
  const { path } = command.opts<CreateOptions>();

  if (path && !command.args.length) {
    command.error(
      "--path requires a project name argument. Usage: base44 create <name> --path <path>",
    );
  }
}

async function createInteractive(
  options: CreateOptions,
  log: Logger,
): Promise<RunCommandResult> {
  const templates = await listTemplates();
  const templateOptions: Option<Template>[] = templates.map((t) => ({
    value: t,
    label: t.name,
    hint: t.description,
  }));

  const result = await group(
    {
      template: () =>
        select({
          message: "Pick an option",
          options: templateOptions,
        }),
      name: () => {
        return options.name
          ? Promise.resolve(options.name)
          : text({
              message: "What is the name of your project?",
              placeholder: basename(process.cwd()),
              initialValue: basename(process.cwd()),
              validate: (value) => {
                if (!value || value.trim().length === 0) {
                  return "Every project deserves a name";
                }
              },
            });
      },
      projectPath: async ({ results }) => {
        const suggestedPath = (await isDirEmpty())
          ? "./"
          : `./${kebabCase(results.name)}`;
        return text({
          message: "Where should we create your project?",
          placeholder: suggestedPath,
          initialValue: suggestedPath,
        });
      },
    },
    {
      onCancel: onPromptCancel,
    },
  );

  return await executeCreate(
    {
      template: result.template,
      name: result.name,
      projectPath: result.projectPath as string,
      deploy: options.deploy,
      skills: options.skills,
      isInteractive: true,
    },
    log,
  );
}

async function createNonInteractive(
  options: CreateOptions,
  log: Logger,
): Promise<RunCommandResult> {
  log.info(`Creating a new project at ${resolve(options.path!)}`);

  const template = await getTemplateById(
    options.template ?? DEFAULT_TEMPLATE_ID,
  );

  return await executeCreate(
    {
      template,
      name: options.name!,
      projectPath: options.path!,
      deploy: options.deploy,
      skills: options.skills,
      isInteractive: false,
    },
    log,
  );
}

async function executeCreate(
  {
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
  },
  log: Logger,
): Promise<RunCommandResult> {
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
    },
  );

  // Set app config in cache for sync access to getDashboardUrl and getAppClient
  setAppConfig({ id: projectId, projectRoot: resolvedPath });

  const { project, entities } = await readProjectConfig(resolvedPath);
  let finalAppUrl: string | undefined;

  if (entities.length > 0) {
    let shouldPushEntities: boolean;

    if (isInteractive) {
      const result = await confirm({
        message:
          "Set up the backend data now? (This pushes the data models used by the template to Base44)",
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
          successMessage: theme.colors.base44Orange(
            "Data models pushed successfully",
          ),
          errorMessage: "Failed to push data models",
        },
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
          successMessage: theme.colors.base44Orange(
            "Site deployed successfully",
          ),
          errorMessage: "Failed to deploy site",
        },
      );

      finalAppUrl = appUrl;
    }
  }

  // Add AI agent skills (--no-skills flag sets skills to false, otherwise defaults to true)
  const shouldAddSkills = skills;

  if (shouldAddSkills) {
    try {
      await runTask(
        "Installing AI agent skills...",
        async () => {
          await execa("npx", ["-y", "skills", "add", "base44/skills", "-y"], {
            cwd: resolvedPath,
            shell: true,
          });
        },
        {
          successMessage: theme.colors.base44Orange(
            "AI agent skills added successfully",
          ),
          errorMessage:
            "Failed to add AI agent skills - you can add them later with: npx skills add base44/skills",
        },
      );
    } catch {
      // Skills installation is non-critical (e.g., user may not have git installed)
      // The error message is already shown by runTask, so we just continue
    }
  }

  log.message(
    `${theme.styles.header("Project")}: ${theme.colors.base44Orange(name)}`,
  );
  log.message(
    `${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(projectId))}`,
  );

  if (finalAppUrl) {
    log.message(
      `${theme.styles.header("Site")}: ${theme.colors.links(finalAppUrl)}`,
    );
  }

  return { outroMessage: "Your project is set up and ready to use" };
}

async function createAction(
  { log, isNonInteractive }: CLIContext,
  name: string | undefined,
  options: CreateOptions,
): Promise<RunCommandResult> {
  if (name && !options.path) {
    options.path = `./${kebabCase(name)}`;
  }

  const skipPrompts = !!(options.name ?? name) && !!options.path;

  if (!skipPrompts && isNonInteractive) {
    throw new InvalidInputError(
      "Project name and --path are required in non-interactive mode",
      {
        hints: [
          {
            message: "Usage: base44 create <name> --path <path>",
          },
        ],
      },
    );
  }

  if (skipPrompts) {
    return await createNonInteractive(
      { name: options.name ?? name, ...options },
      log,
    );
  }
  return await createInteractive({ name, ...options }, log);
}

export function getCreateCommand(): Command {
  return new Base44Command("create", {
    requireAppConfig: false,
    fullBanner: true,
  })
    .description("Create a new Base44 project")
    .addArgument(new Argument("name", "Project name").argOptional())
    .option("-p, --path <path>", "Path where to create the project")
    .option(
      "-t, --template <id>",
      "Template ID (e.g., backend-only, backend-and-client)",
    )
    .option("--deploy", "Build and deploy the site")
    .option("--no-skills", "Skip AI agent skills installation")
    .addHelpText(
      "after",
      `
Examples:
  $ base44 create my-app                                         Creates a base44 project at ./my-app
  $ base44 create my-todo-app --template backend-and-client      Creates a base44 backend-and-client project at ./my-todo-app
  $ base44 create my-app --path ./projects/my-app --deploy       Creates a base44 project at ./project/my-app and deploys it`,
    )
    .hook("preAction", validateNonInteractiveFlags)
    .action(createAction);
}
