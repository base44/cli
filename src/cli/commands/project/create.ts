import { resolve } from "node:path";
import { Command } from "commander";
import { log, group, text, select } from "@clack/prompts";
import chalk from "chalk";
import { loadProjectEnv } from "@core/config.js";
import { createProjectFiles, listTemplates } from "@core/project/index.js";
import type { Template } from "@core/project/index.js";
import { runTask, printBanner, onPromptCancel } from "../../utils/index.js";

async function create(): Promise<void> {
  printBanner();

  // Load .env.local from project root (if in a project)
  await loadProjectEnv();

  // Load available templates for the select options
  const templates = await listTemplates();
  const templateOptions = templates.map((t: Template) => ({
    value: t,
    label: t.name,
    hint: t.description,
  }));

  // Gather all project details in a single group
  const { template, name, description, projectPath } = await group(
    {
      template: () =>
        select({
          message: "Select a project template",
          options: templateOptions,
        }),
      name: () =>
        text({
          message: "What is the name of your project?",
          placeholder: "my-app-backend",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Project name is required";
            }
          },
        }),
      description: () =>
        text({
          message: "Project description (optional)",
          placeholder: "A brief description of your project",
        }),
      projectPath: () =>
        text({
          message: "Where should we create the base44 folder?",
          placeholder: "./",
          initialValue: "./",
        }),
    },
    {
      onCancel: onPromptCancel,
    }
  );

  const resolvedPath = resolve(projectPath || "./");

  // Create the project
  await runTask(
    "Creating project...",
    async () => {
      return await createProjectFiles({
        name: name.trim(),
        description: description ? description.trim() : undefined,
        path: resolvedPath,
        template,
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

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .action(async () => {
    try {
      await create();
    } catch (e) {
      if (e instanceof Error) {
        log.error(e.stack ?? e.message);
      } else {
        log.error(String(e));
      }
      process.exit(1);
    }
  });
