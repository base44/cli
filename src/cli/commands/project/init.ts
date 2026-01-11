import { resolve } from "node:path";
import { Command } from "commander";
import { log } from "@clack/prompts";
import chalk from "chalk";
import { loadProjectEnv } from "@core/config.js";
import { initProject } from "@core/project/index.js";
import { runTask, textPrompt, printBanner } from "../../utils/index.js";

async function init(): Promise<void> {
  printBanner();

  // Load .env.local from project root (if in a project)
  await loadProjectEnv();

  const name = await textPrompt({
    message: "What is the name of your project?",
    placeholder: "my-app-backend",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Project name is required";
      }
    },
  });

  // Ask for description (optional)
  const description: string | undefined = await textPrompt({
    message: "Project description (optional)",
    placeholder: "A brief description of your project",
  });

  // Ask for project path with default
  const defaultPath = "./";
  const projectPath = await textPrompt({
    message: "Where should we create the base44 folder?",
    placeholder: defaultPath,
    initialValue: defaultPath,
  });

  const resolvedPath = resolve(projectPath || defaultPath);

  // Create the project
  await runTask(
    "Creating project...",
    async () => {
      return await initProject({
        name: name.trim(),
        description: description ? description.trim() : undefined,
        path: resolvedPath,
      });
    },
    {
      successMessage: "Project created successfully",
      errorMessage: "Failed to create project",
    }
  );

  // Display success message with details
  log.success(`Project ${chalk.bold(name)} has been initialized!`);
}

export const initCommand = new Command("init")
  .alias("create")
  .description("Initialize a new Base44 project")
  .action(async () => {
    try {
      await init();
    } catch (e) {
      if (e instanceof Error) {
        log.error(e.stack ?? e.message);
      } else {
        log.error(String(e));
      }
      process.exit(1);
    }
  });
