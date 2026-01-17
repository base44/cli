import { resolve } from "node:path";
import { log, group, text, select, cancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import kebabCase from "lodash.kebabcase";
import { BaseCommand } from "../lib/base-command.js";
import { runTask } from "../lib/index.js";
import { createProjectFiles, listTemplates } from "../../core/project/index.js";
import type { Template } from "../../core/project/index.js";
import { getBase44ApiUrl } from "../../core/config.js";


export default class Create extends BaseCommand {
  static override description = "Create a new Base44 project";
  static override examples = ["<%= config.bin %> create"];

  static override showFullBanner = true;

  async run(): Promise<void> {
    const templates = await listTemplates();
    const templateOptions: Array<Option<Template>> = templates.map((t) => ({
      value: t,
      label: t.name,
      hint: t.description,
    }));

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
        projectPath: async ({ results }) => {
          const suggestedPath = `./${kebabCase(results.name)}`;
          return text({
            message: "Where should we create the base44 folder?",
            placeholder: suggestedPath,
            initialValue: suggestedPath,
          });
        },
      },
      {
        onCancel: () => {
          cancel("Operation cancelled.");
          process.exit(0);
        },
      }
    );

    const resolvedPath = resolve(projectPath as string);

    // Create the project
    const { projectId } = await runTask(
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

    log.success(`Project ${chalk.bold(name)} has been initialized!`);
    log.success(
      `Dashboard link:\n${chalk.bold(`${getBase44ApiUrl()}/apps/${projectId}/editor/preview`)}`
    );
  }
}
