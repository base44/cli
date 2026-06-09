import { basename, resolve } from "node:path";
import type { Option } from "@clack/prompts";
import { group, select, text } from "@clack/prompts";
import { Argument, type Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, onPromptCancel, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import type { Template } from "@/core/project/index.js";
import {
  initProjectFiles,
  listTemplates,
  setAppConfig,
} from "@/core/project/index.js";
import {
  completeProjectSetup,
  DEFAULT_TEMPLATE_ID,
  getTemplateById,
} from "./scaffold-shared.js";

interface InitOptions {
  name?: string;
  path?: string;
  template?: string;
  appId?: string;
  deploy?: boolean;
  skills?: boolean;
}

/**
 * Resolves the existing app ID from --app-id or the BASE44_APP_ID environment
 * variable (written by the Stripe Projects CLI via `stripe projects env --pull`).
 */
function resolveAppId(options: InitOptions): string {
  const appId = options.appId ?? process.env.BASE44_APP_ID;
  if (!appId) {
    throw new InvalidInputError(
      "No app ID found. `base44 init` scaffolds a local project for an existing Base44 app.",
      {
        hints: [
          { message: "Pass it explicitly with --app-id <id>" },
          {
            message:
              "Or set BASE44_APP_ID (the Stripe Projects CLI writes it to .env via `stripe projects env --pull`)",
          },
        ],
      },
    );
  }
  return appId;
}

async function executeInit(
  {
    template,
    name: rawName,
    description,
    appId,
    projectPath,
    deploy,
    skills,
    isInteractive,
  }: {
    template: Template;
    name: string;
    description?: string;
    appId: string;
    projectPath: string;
    deploy?: boolean;
    skills?: boolean;
    isInteractive: boolean;
  },
  { log, runTask }: Pick<CLIContext, "log" | "runTask">,
): Promise<RunCommandResult> {
  const name = rawName.trim();
  const resolvedPath = resolve(projectPath);

  const { projectId, skippedFiles } = await runTask(
    "Setting up your project...",
    async () => {
      return await initProjectFiles({
        name,
        description: description?.trim(),
        path: resolvedPath,
        template,
        appId,
      });
    },
    {
      successMessage: theme.colors.base44Orange("Project created successfully"),
      errorMessage: "Failed to create project",
    },
  );

  if (skippedFiles.length > 0) {
    log.info(
      `Kept existing file${skippedFiles.length > 1 ? "s" : ""}: ${skippedFiles.join(", ")}`,
    );
  }

  // Set app config in cache for sync access to getDashboardUrl and getAppClient
  setAppConfig({ id: projectId, projectRoot: resolvedPath });

  return await completeProjectSetup(
    { projectId, name, resolvedPath, deploy, skills, isInteractive },
    { log, runTask },
  );
}

async function initInteractive(
  appId: string,
  options: InitOptions,
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
      // init scaffolds into the existing project directory by default.
      projectPath: () =>
        text({
          message: "Where should we set up your project?",
          placeholder: "./",
          initialValue: options.path ?? "./",
        }),
    },
    {
      onCancel: onPromptCancel,
    },
  );

  return await executeInit(
    {
      template: result.template,
      name: result.name,
      appId,
      projectPath: result.projectPath as string,
      deploy: options.deploy,
      skills: options.skills,
      isInteractive: true,
    },
    ctx,
  );
}

async function initNonInteractive(
  appId: string,
  options: InitOptions,
  ctx: Pick<CLIContext, "log" | "runTask">,
): Promise<RunCommandResult> {
  const projectPath = options.path ?? "./";
  const name = options.name ?? basename(resolve(projectPath));

  ctx.log.info(`Initializing project at ${resolve(projectPath)}`);

  const template = await getTemplateById(
    options.template ?? DEFAULT_TEMPLATE_ID,
  );

  return await executeInit(
    {
      template,
      name,
      appId,
      projectPath,
      deploy: options.deploy,
      skills: options.skills,
      isInteractive: false,
    },
    ctx,
  );
}

async function initAction(
  { log, runTask, isNonInteractive }: CLIContext,
  name: string | undefined,
  options: InitOptions,
): Promise<RunCommandResult> {
  const appId = resolveAppId(options);
  const opts: InitOptions = { ...options, name: options.name ?? name };
  const ctx = { log, runTask };

  if (isNonInteractive) {
    return await initNonInteractive(appId, opts, ctx);
  }
  return await initInteractive(appId, opts, ctx);
}

export function getInitCommand(): Command {
  return new Base44Command("init", {
    requireAppConfig: false,
    fullBanner: true,
  })
    .description(
      "Scaffold a local project for an existing Base44 app (e.g. one provisioned by the Stripe Projects CLI)",
    )
    .addArgument(new Argument("name", "Project name").argOptional())
    .option(
      "--app-id <id>",
      "Existing Base44 app ID (defaults to the BASE44_APP_ID environment variable)",
    )
    .option(
      "-p, --path <path>",
      "Path where to set up the project (defaults to the current directory)",
    )
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
  $ base44 init                                  Scaffolds in the current dir using $BASE44_APP_ID
  $ base44 init --app-id app_123                 Scaffolds in the current dir for the given app
  $ base44 init my-app --app-id app_123          Scaffolds in the current dir named "my-app"`,
    )
    .action(initAction);
}
