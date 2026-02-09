import { resolve } from "node:path";
import type { Option } from "@clack/prompts";
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import { Command } from "commander";
import { execa } from "execa";
import kebabCase from "lodash.kebabcase";
import { deployAction } from "@/cli/commands/project/deploy.js";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import {
  createProject,
  createProjectFilesForExistingProject,
  isDirEmpty,
  listProjects,
  type Project,
  readProjectConfig,
  setAppConfig,
  writeAppConfig,
  writeFile,
} from "@/core/index.js";

interface EjectOptions {
  path?: string;
}

async function eject(options: EjectOptions): Promise<RunCommandResult> {
  const projects = await listProjects();
  const ejectableProjects = projects.filter(
    (p) => p.isManagedSourceCode !== false
  );

  const projectOptions: Option<Project>[] = ejectableProjects.map((p) => ({
    value: p,
    label: p.name,
    hint: p.userDescription,
  }));

  const selectedProject = await select({
    message: `Choose a project to download ${theme.styles.dim("(Note: this will clone the selected project)")}`,
    options: projectOptions,
  });

  if (isCancel(selectedProject)) {
    cancel("Operation cancelled.");
    process.exit(0);
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
    process.exit(0);
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
        selectedProject.userDescription
      );

      updateMessage("Linking the project...");

      await writeAppConfig(resolvedPath, newProjectId);
      await writeFile(
        `${resolvedPath}/.env.local`,
        `VITE_BASE44_APP_ID=${newProjectId}`
      );

      setAppConfig({ id: newProjectId, projectRoot: resolvedPath });
    },
    {
      successMessage: theme.colors.base44Orange("Project pulled successfully"),
      errorMessage: "Failed to link project",
    }
  );

  const shouldDeploy = await confirm({
    message: "Would you like to deploy your project now?",
  });

  const { project } = await readProjectConfig(resolvedPath);
  const installCommand = project.site?.installCommand;
  const buildCommand = project.site?.buildCommand;

  if (
    !isCancel(shouldDeploy) &&
    shouldDeploy &&
    installCommand &&
    buildCommand
  ) {
    try {
      await runTask(
        "Installing dependencies...",
        async (updateMessage) => {
          await execa({ cwd: resolvedPath, shell: true })`${installCommand}`;

          updateMessage("Building project...");
          await execa({ cwd: resolvedPath, shell: true })`${buildCommand}`;
        },
        {
          successMessage: theme.colors.base44Orange(
            "Project built successfully"
          ),
          errorMessage: "Failed to build project",
        }
      );

      await deployAction({ yes: true });
    } catch (error) {
      console.error(error);
    }
  }

  return { outroMessage: "Your new project is set and ready to use" };
}

export function getEjectCommand(context: CLIContext): Command {
  return new Command("eject")
    .description("Download the code for an existing Base44 project")
    .option("-p, --path <path>", "Path where to write the project")
    .action(async (options: EjectOptions) => {
      await runCommand(
        () => eject(options),
        { requireAuth: true, requireAppConfig: false },
        context
      );
    });
}
