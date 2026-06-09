import { basename, resolve } from "node:path";
import { Argument, type Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { initProjectFiles, setAppConfig } from "@/core/project/index.js";
import {
  completeProjectSetup,
  getTemplateById,
  printProjectSummary,
} from "./scaffold-shared.js";

interface ScaffoldOptions {
  appId?: string;
  skills?: boolean;
}

function resolveAppId(options: ScaffoldOptions): string {
  const appId = options.appId ?? process.env.BASE44_APP_ID;
  if (!appId) {
    throw new InvalidInputError(
      "No app ID found. `base44 scaffold` sets up a local project for an existing Base44 app.",
      {
        hints: [{ message: "Pass it explicitly with --app-id <id>" }],
      },
    );
  }
  return appId;
}

async function scaffoldAction(
  ctx: CLIContext,
  name: string | undefined,
  options: ScaffoldOptions,
): Promise<RunCommandResult> {
  const { log, runTask } = ctx;
  const appId = resolveAppId(options);
  const resolvedPath = resolve("./");
  const projectName = (name ?? basename(resolvedPath)).trim();
  const template = await getTemplateById("backend-only");

  log.info(`Scaffolding project at ${resolvedPath}`);

  const { projectId } = await runTask(
    "Setting up your project...",
    async () => {
      return await initProjectFiles({
        name: projectName,
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

  setAppConfig({ id: projectId, projectRoot: resolvedPath });

  const summary = await completeProjectSetup(
    {
      projectId,
      name: projectName,
      resolvedPath,
      deploy: false,
      skills: options.skills,
      isInteractive: false,
    },
    ctx,
  );
  printProjectSummary(summary, log);

  return { outroMessage: "Your project is set up and ready to use" };
}

export function getScaffoldCommand(): Command {
  return new Base44Command("scaffold", {
    requireAppConfig: false,
    fullBanner: true,
  })
    .description("Scaffold a local project for an existing Base44 app")
    .addArgument(new Argument("name", "Project name").argOptional())
    .option("--app-id <id>", "Existing Base44 app ID")
    .option("--no-skills", "Skip AI agent skills installation")
    .addHelpText(
      "after",
      `
Examples:
  $ base44 scaffold --app-id app_123         Scaffolds the current dir for the given app
  $ base44 scaffold my-app --app-id app_123  Scaffolds the current dir, named "my-app"`,
    )
    .action(scaffoldAction);
}
