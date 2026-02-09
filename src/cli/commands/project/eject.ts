import { resolve } from "node:path";
import { Command } from "commander";
import { select, isCancel, cancel, text, confirm } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import { runCommand, runTask, theme } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import kebabCase from "lodash.kebabcase";
import { execa } from "execa";
import { deployAction } from "./deploy.js";
import { createProject, createProjectFilesForExistingProject, isDirEmpty, listProjects, Project, writeAppConfig, writeJsonFile, writeFile, setAppConfig } from "@/core/index.js";
import { CLIContext } from "@/cli/types.js";

interface EjectOptions {
  path?: string;
}

async function eject(options: EjectOptions): Promise<RunCommandResult> {
  const projects = await listProjects();
  const ejectableProjects = projects.filter((p) => p.isManagedSourceCode !== false);
  const projectOptions: Array<Option<Project>> = ejectableProjects.map((p) => ({
    value: p,
    label: p.name,
    hint: p.userDescription,
  }));

  const selectedProject = false ? { id: '697e53fdb9fbf6eb3c4b8b8d', name: 'Home', isManagedSourceCode: true, userDescription: 'desc' } : await select({
    message: "Choose a project to download",
    options: projectOptions,
  });

  if (isCancel(selectedProject)) {
    cancel("Operation cancelled.");
    process.exit(0);
  };

  const projectId = selectedProject.id;
  const suggestedPath = await isDirEmpty() ? `./` : `./${kebabCase(selectedProject.name)}`;

  const selectedPath = options.path ?? await text({
    message: "Where should we create your project?",
    placeholder: suggestedPath,
    initialValue: suggestedPath,
  });

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
        projectName: selectedProject.name,
        projectPath: resolvedPath,
      });

      updateMessage('Creating a new project...');

      const newProjectName = `${selectedProject.name} Copy`;
      const { projectId: newProjectId } = await createProject(newProjectName, selectedProject.userDescription)

      updateMessage('Linking the project...');

      await writeAppConfig(resolvedPath, newProjectId);
      await writeFile(`${resolvedPath}/.env.local`, `VITE_BASE44_APP_ID=${newProjectId}`);

      setAppConfig({ id: newProjectId, projectRoot: resolvedPath });
    },
    {
      successMessage: theme.colors.base44Orange("Project pulled successfully"),
      errorMessage: "Failed to link project",
    }
  );

  const shouldDeploy = await confirm({
    message: 'Would you like to deploy your project now?'
  });

  if (!isCancel(shouldDeploy) && shouldDeploy) {
    try {
      await runTask(
        "Installing dependencies...",
        async (updateMessage) => {
          await execa({ cwd: resolvedPath, shell: true })`npm install`;

          updateMessage("Building project...");
          await execa({ cwd: resolvedPath, shell: true })`npm run build`;
        },
        {
          successMessage: theme.colors.base44Orange("Project built successfully"),
          errorMessage: "Failed to build project",
        }
      );

      await deployAction({ yes: true });
    } catch (error) { console.error(error); }
  };

  return { outroMessage: "Your new project is set and ready to use" };
}

export function getEjectCommand(context: CLIContext): Command {
  return new Command("eject")
    .description("Download the code for an existing Base44 project")
    .option("-p, --path <path>", "Path where to write the project")
    .action(async (options: EjectOptions) => {
      await runCommand(() => eject(options), { requireAuth: true, requireAppConfig: false }, context);
    });
} 
