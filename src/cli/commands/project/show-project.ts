import { Command } from "commander";
import { log } from "@clack/prompts";
import { readProjectConfig } from "../../../core/config/project.js";
import { runCommand, runTask } from "../../utils/index.js";

async function showProject(): Promise<void> {
  const projectData = await runTask(
    "Reading project configuration",
    async () => {
      return await readProjectConfig();
    },
    {
      successMessage: "Project configuration loaded",
      errorMessage: "Failed to load project configuration",
    }
  );

  const jsonOutput = JSON.stringify(projectData, null, 2);
  log.info(jsonOutput);
}

export const showProjectCommand = new Command("show-project")
  .description("Display project configuration, entities, and functions")
  .action(async () => {
    await runCommand(showProject);
  });
