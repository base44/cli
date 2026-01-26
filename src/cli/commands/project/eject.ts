import { join, resolve } from "node:path";
import { Command } from "commander";
import { select, isCancel, cancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import { createProjectFilesForExistingProject, listProjects, setAppConfig } from "@core/project/index.js";
import type { Project } from "@core/project/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { getFunctions, pullEntities, pullFunctions, pushEntities, pushFunctions } from "@core/resources/index.js";

const orange = chalk.hex("#E86B3C");
const cyan = chalk.hex("#00D4FF");

async function eject(): Promise<RunCommandResult> {
  const projects = await listProjects();
  const ejectableProjects = projects.filter((p) => p.isManagedSourceCode !== false);
  const projectOptions: Array<Option<Project>> = ejectableProjects.map((p) => ({
    value: p,
    label: p.name,
    hint: p.userDescription,
  }));

  const selectedProject = await select({
    message: "Choose a project to download",
    options: projectOptions,
  });

  if (isCancel(selectedProject)) {
    cancel("Operation cancelled.");
    process.exit(0);
  };

  const projectId = selectedProject.id;
  const resolvedPath = resolve('./');

  const { projectId: newProjectId, projectDir } = await runTask(
    "Downloading your project's code...",
    async () => {
      return await createProjectFilesForExistingProject({
        projectId,
        projectName: selectedProject.name,
        path: resolvedPath,
      });
    },
    {
      successMessage: orange("Project pulled successfully"),
      errorMessage: "Failed to link project",
    }
  );

  // Push in behalf of the existing project
  setAppConfig({ id: projectId, projectRoot: resolvedPath });

  const entities = await pullEntities(projectDir);
  const functions = await pullFunctions(projectDir);

  // Push in behalf of the new project
  setAppConfig({ id: newProjectId, projectRoot: resolvedPath });

  if (entities.length > 0) {
    try {
      await runTask(
        "Syncing your project's entities...",
        async () => {
          // Pull the entities from the original project

          await pushEntities(entities);
        },
        {
          successMessage: orange("Project entities synced successfully"),
          errorMessage: "Failed to sync project entities",
        }
      );
    } catch (error) { console.error(error); }
  }

  try {
    await runTask(
      "Syncing your project's backend functions...",
      async () => {
        await pushFunctions(functions);
      },
      {
        successMessage: orange("Project functions synced successfully"),
        errorMessage: "Failed to sync project functions",
      }
    );
  } catch (error) { console.error(error); }

  return { outroMessage: "Your project is set and ready to use" };
}

export const ejectCommand = new Command("eject")
  .description("Download the code for an existing Base44 project")
  .action(async () => {
    await runCommand(eject, { requireAuth: true, requireAppConfig: false });
  });
