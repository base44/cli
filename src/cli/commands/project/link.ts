import { resolve } from "node:path";
import { Command } from "commander";
import { select, isCancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import { createProjectFileForExistingProject, listProjects, readProjectConfig } from "@core/project/index.js";
import type { Project } from "@core/project/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

const orange = chalk.hex("#E86B3C");
const cyan = chalk.hex("#00D4FF");

async function link(): Promise<RunCommandResult> {
  const projects = await listProjects();
  const projectOptions: Array<Option<Project>> = projects.map((p) => ({
    value: p,
    label: p.name,
    hint: p.user_description,
  }));

  const selectedProject = await select({
    message: "Select a project",
    options: projectOptions,
  });

  if (isCancel(selectedProject)) {
    return { outroMessage: "Project selection cancelled" };
  };

  const projectId = (selectedProject as Project).id;
  const resolvedPath = resolve('./');

  if (selectedProject) {
    await runTask(
      "Pulling your project...",
      async () => {
        return await createProjectFileForExistingProject({
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
  }

  return { outroMessage: "Your project is set and ready to use" };
}

export const linkCommand = new Command("link")
  .description("Link an existing Base44 project")
  .action(async () => {
    await runCommand(link, { requireAuth: true });
  });
