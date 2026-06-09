import { basename, resolve } from "node:path";
import type { Option } from "@clack/prompts";
import { group, select, text } from "@clack/prompts";
import { Argument, type Command } from "commander";
import kebabCase from "lodash/kebabCase";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, onPromptCancel, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { isDirEmpty } from "@/core/index.js";
import type { Template } from "@/core/project/index.js";
import {
  createProjectFiles,
  listTemplates,
  setAppConfig,
} from "@/core/project/index.js";
import {
  completeProjectSetup,
  DEFAULT_TEMPLATE_ID,
  getTemplateById,
} from "./scaffold-shared.js";

interface CreateOptions {
  name?: string;
  path?: string;
  template?: string;
  deploy?: boolean;
  skills?: boolean;
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
  ctx: Pick<CLIContext, "log" | "runTask">,
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
    ctx,
  );
}

async function createNonInteractive(
  options: CreateOptions,
  ctx: Pick<CLIContext, "log" | "runTask">,
): Promise<RunCommandResult> {
  ctx.log.info(`Creating a new project at ${resolve(options.path!)}`);

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
    ctx,
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
  { log, runTask }: Pick<CLIContext, "log" | "runTask">,
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

  return await completeProjectSetup(
    { projectId, name, resolvedPath, deploy, skills, isInteractive },
    { log, runTask },
  );
}

async function createAction(
  { log, runTask, isNonInteractive }: CLIContext,
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

  const ctx = { log, runTask };

  if (skipPrompts) {
    return await createNonInteractive(
      { name: options.name ?? name, ...options },
      ctx,
    );
  }
  return await createInteractive({ name, ...options }, ctx);
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
