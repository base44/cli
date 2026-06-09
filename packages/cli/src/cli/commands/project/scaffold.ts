import { basename, resolve } from "node:path";
import { Argument, type Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { initProjectFiles, setAppConfig } from "@/core/project/index.js";
import { completeProjectSetup, getTemplateById } from "./scaffold-shared.js";

interface ScaffoldOptions {
  appId?: string;
  skills?: boolean;
}

/**
 * Resolves the existing app ID from --app-id or the BASE44_APP_ID environment
 * variable (e.g. written to `.env` by a CI pipeline or provisioning tool).
 */
function resolveAppId(options: ScaffoldOptions): string {
  const appId = options.appId ?? process.env.BASE44_APP_ID;
  if (!appId) {
    throw new InvalidInputError(
      "No app ID found. `base44 scaffold` sets up a local project for an existing Base44 app.",
      {
        hints: [
          { message: "Pass it explicitly with --app-id <id>" },
          {
            message:
              "Or set the BASE44_APP_ID environment variable (e.g. via .env)",
          },
        ],
      },
    );
  }
  return appId;
}

async function scaffoldAction(
  { log, runTask }: CLIContext,
  name: string | undefined,
  options: ScaffoldOptions,
): Promise<RunCommandResult> {
  const appId = resolveAppId(options);
  // Sets up an existing app in the current directory, using the minimal
  // template — there is nothing to prompt for.
  const resolvedPath = resolve("./");
  const projectName = (name ?? basename(resolvedPath)).trim();
  const template = await getTemplateById("backend-only");

  log.info(`Scaffolding project at ${resolvedPath}`);

  const { projectId, skippedFiles } = await runTask(
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

  if (skippedFiles.length > 0) {
    log.info(
      `Kept existing file${skippedFiles.length > 1 ? "s" : ""}: ${skippedFiles.join(", ")}`,
    );
  }

  // Set app config in cache for sync access to getDashboardUrl and getAppClient
  setAppConfig({ id: projectId, projectRoot: resolvedPath });

  return await completeProjectSetup(
    {
      projectId,
      name: projectName,
      resolvedPath,
      deploy: false,
      skills: options.skills,
      isInteractive: false,
    },
    { log, runTask },
  );
}

export function getScaffoldCommand(): Command {
  return new Base44Command("scaffold", {
    requireAppConfig: false,
    fullBanner: true,
  })
    .description("Scaffold a local project for an existing Base44 app")
    .addArgument(new Argument("name", "Project name").argOptional())
    .option(
      "--app-id <id>",
      "Existing Base44 app ID (defaults to the BASE44_APP_ID environment variable)",
    )
    .option("--no-skills", "Skip AI agent skills installation")
    .addHelpText(
      "after",
      `
Examples:
  $ base44 scaffold                          Scaffolds the current dir for $BASE44_APP_ID
  $ base44 scaffold --app-id app_123         Scaffolds the current dir for the given app
  $ base44 scaffold my-app --app-id app_123  Scaffolds the current dir, named "my-app"`,
    )
    .action(scaffoldAction);
}
