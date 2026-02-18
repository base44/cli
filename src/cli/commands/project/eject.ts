import { resolve } from "node:path";
import type { Option } from "@clack/prompts";
import { cancel, confirm, isCancel, log, select, text } from "@clack/prompts";
import { Command } from "commander";
import { execa } from "execa";
import kebabCase from "lodash.kebabcase";
import { deployAction } from "@/cli/commands/project/deploy.js";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { Project } from "@/core/index.js";
import {
  createProject,
  createProjectFilesForExistingProject,
  InvalidInputError,
  isDirEmpty,
  listProjects,
  readProjectConfig,
  setAppConfig,
  writeAppConfig,
  writeFile,
} from "@/core/index.js";

interface EjectOptions {
  path?: string;
  projectId?: string;
  yes?: boolean;
  isNonInteractive?: boolean;
}

async function eject(options: EjectOptions): Promise<RunCommandResult> {
  const projects = await listProjects();
  const ejectableProjects = projects.filter(
    (p) => p.isManagedSourceCode !== false,
  );

  let selectedProject: Project;

  if (options.projectId) {
    const foundProject = ejectableProjects.find(
      (p) => p.id === options.projectId,
    );

    if (!foundProject) {
      throw new InvalidInputError(
        `Project with ID "${options.projectId}" not found or not ejectable`,
        {
          hints: [
            {
              message:
                "Run 'base44 eject' without --project-id to see available projects",
            },
          ],
        },
      );
    }

    selectedProject = foundProject;
    log.info(`Selected project: ${theme.styles.bold(selectedProject.name)}`);
  } else {
    // Interactive: show project selection prompt
    const projectOptions: Option<Project>[] = ejectableProjects.map((p) => ({
      value: p,
      label: p.name,
      hint: p.userDescription ?? undefined,
    }));

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

      setAppConfig({ id: newProjectId, projectRoot: resolvedPath });
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

      await deployAction({ yes: true, projectRoot: resolvedPath });
    }
  }

  return { outroMessage: "Your new project is set and ready to use" };
}

export function getEjectCommand(context: CLIContext): Command {
  return new Command("eject")
    .description("Download the code for an existing Base44 project")
    .option("-p, --path <path>", "Path where to write the project")
    .option(
      "--project-id <id>",
      "Project ID to eject (skips interactive selection)",
    )
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (options: EjectOptions) => {
      await runCommand(
        () => eject({ ...options, isNonInteractive: context.isNonInteractive }),
        { requireAuth: true, requireAppConfig: false },
        context,
      );
    });
}
