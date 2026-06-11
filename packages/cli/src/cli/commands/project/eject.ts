import { resolve } from "node:path";
import type { Option as PromptOption } from "@clack/prompts";
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import { type Command, Option as CommanderOption } from "commander";
import { execa } from "execa";
import kebabCase from "lodash/kebabCase";
import { deployAction } from "@/cli/commands/project/deploy.js";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import type { Project } from "@/core/index.js";
import {
  createProject,
  createProjectFilesForExistingProject,
  InvalidInputError,
  isDirEmpty,
  listProjects,
  readProjectConfig,
  setAppContext,
  writeAppConfig,
  writeFile,
} from "@/core/index.js";
import { readExplicitAppId } from "./app-id-options.js";

interface EjectOptions {
  path?: string;
  yes?: boolean;
}

async function eject(
  ctx: CLIContext,
  options: EjectOptions,
  command: Command,
): Promise<RunCommandResult> {
  const { log, runTask, isNonInteractive } = ctx;
  const {
    appId,
    legacyProjectId,
    value: selectedAppId,
  } = readExplicitAppId(command);
  if (appId && legacyProjectId) {
    throw new InvalidInputError(
      "--app-id and --project-id cannot be used together",
    );
  }

  if (isNonInteractive && !selectedAppId) {
    throw new InvalidInputError("--app-id is required in non-interactive mode");
  }
  if (isNonInteractive && !options.path) {
    throw new InvalidInputError("--path is required in non-interactive mode");
  }

  const projects = await listProjects();
  const ejectableProjects = projects.filter(
    (p) => p.isManagedSourceCode !== false,
  );

  let selectedProject: Project;

  if (selectedAppId) {
    const foundProject = ejectableProjects.find((p) => p.id === selectedAppId);

    if (!foundProject) {
      throw new InvalidInputError(
        `App with ID "${selectedAppId}" not found or not ejectable`,
        {
          hints: [
            {
              message:
                "Run 'base44 eject' without --app-id to see available projects",
            },
          ],
        },
      );
    }

    selectedProject = foundProject;
    log.info(`Selected project: ${theme.styles.bold(selectedProject.name)}`);
  } else {
    if (ejectableProjects.length === 0) {
      return { outroMessage: "No projects available to eject." };
    }

    const projectOptions: PromptOption<Project>[] = ejectableProjects.map(
      (p) => ({
        value: p,
        label: p.name,
        hint: p.userDescription ?? undefined,
      }),
    );

    const selected = await select({
      message: `Choose a project to download ${theme.styles.dim("(Note: this will clone the selected project)")}`,
      options: projectOptions,
    });

    if (isCancel(selected)) {
      cancel("Operation cancelled.");
      throw new CLIExitError(0);
    }
    selectedProject = selected;
  }

  const projectId = selectedProject.id;
  const suggestedPath = (await isDirEmpty())
    ? `./`
    : `./${kebabCase(selectedProject.name)}`;

  const selectedPath =
    options.path ??
    (await text({
      message: "Where should we create your project?",
      placeholder: suggestedPath,
      initialValue: suggestedPath,
    }));

  if (isCancel(selectedPath)) {
    cancel("Operation cancelled.");
    throw new CLIExitError(0);
  }

  const resolvedPath = resolve(selectedPath);

  await runTask(
    "Downloading your project's code...",
    async (updateMessage) => {
      await createProjectFilesForExistingProject({
        projectId,
        projectPath: resolvedPath,
      });

      updateMessage("Creating a new project...");

      const newProjectName = `${selectedProject.name} Copy`;
      const { projectId: newProjectId } = await createProject(
        newProjectName,
        selectedProject.userDescription ?? undefined,
      );

      updateMessage("Linking the project...");

      await writeAppConfig(resolvedPath, newProjectId);
      await writeFile(
        `${resolvedPath}/.env.local`,
        `VITE_BASE44_APP_ID=${newProjectId}`,
      );

      setAppContext({ id: newProjectId, projectRoot: resolvedPath });
    },
    {
      successMessage: theme.colors.base44Orange("Project pulled successfully"),
      errorMessage: "Failed to pull project",
    },
  );

  const { project } = await readProjectConfig(resolvedPath);
  const installCommand = project.site?.installCommand;
  const buildCommand = project.site?.buildCommand;

  // Only offer deploy if the project has build commands configured
  if (installCommand && buildCommand) {
    const shouldDeploy = options.yes
      ? true
      : await confirm({
          message: "Would you like to deploy your project now?",
        });

    if (!isCancel(shouldDeploy) && shouldDeploy) {
      await runTask(
        "Installing dependencies...",
        async (updateMessage) => {
          await execa({ cwd: resolvedPath, shell: true })`${installCommand}`;

          updateMessage("Building project...");
          await execa({ cwd: resolvedPath, shell: true })`${buildCommand}`;
        },
        {
          successMessage: theme.colors.base44Orange(
            "Project built successfully",
          ),
          errorMessage: "Failed to build project",
        },
      );

      await deployAction(ctx, { yes: true, projectRoot: resolvedPath });
    }
  }

  return { outroMessage: "Your new project is set and ready to use" };
}

export function getEjectCommand(): Command {
  return (
    new Base44Command("eject", {
      requireAppContext: false,
    })
      .description("Download the code for an existing Base44 project")
      .configureHelp({ showGlobalOptions: true })
      .option("-p, --path <path>", "Path where to write the project")
      .option("-y, --yes", "Skip confirmation prompts")
      // TODO: Remove --project-id once docs and Base44 CLI skills use --app-id. Kept hidden for backward compatibility.
      .addOption(
        new CommanderOption(
          "--project-id <id>",
          "Project ID to eject (skips interactive selection)",
        ).hideHelp(),
      )
      .action(eject)
  );
}
