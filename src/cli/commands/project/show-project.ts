import { Command } from "commander";
import { spinner, log } from "@clack/prompts";
import { readProjectConfig } from "../../../core/config/project.js";
import { runCommand } from "../../utils/index.js";

async function showProject(): Promise<void> {
  const s = spinner();
  s.start("Reading project configuration");

  const projectData = await readProjectConfig();
  s.stop("Project configuration loaded");
  const jsonOutput = JSON.stringify(projectData, null, 2);
  log.info(jsonOutput);
}

export const showProjectCommand = new Command("show-project")
  .description("Display project configuration, entities, and functions")
  .action(async () => {
    await runCommand(showProject);
  });
