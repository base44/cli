import { resolve } from "node:path";
import { Command } from "commander";
import { group, text, select, intro, log, outro } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import chalk from "chalk";
import kebabCase from "lodash.kebabcase";
import { createProjectFiles, listTemplates } from "@core/project/index.js";
import type { Template } from "@core/project/index.js";
import { getBase44ApiUrl } from "@core/config.js";
import { runCommand, runTask, onPromptCancel } from "../../utils/index.js";

const orange = chalk.hex("#E86B3C");
const cyan = chalk.hex("#00D4FF");

async function create(): Promise<void> {
  intro("Let's create something amazing!");

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
          message: "Pick a template",
          options: templateOptions,
        }),
      name: () =>
        text({
          message: "What is the name of your project?",
          placeholder: "my-app",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Every project deserves a name";
            }
          },
        }),
      description: () =>
        text({
          message: "Description (optional)",
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
      onCancel: onPromptCancel,
    }
  );

  const resolvedPath = resolve(projectPath as string);

  // Create the project
  const { projectId } = await runTask(
    "Setting up your project...",
    async () => {
      return await createProjectFiles({
        name: name.trim(),
        description: description ? description.trim() : undefined,
        path: resolvedPath,
        template,
      });
    },
    {
      successMessage: `${orange("✓")} ${chalk.bold("Project created successfully!")}`,
      errorMessage: "Failed to create project",
    }
  );

  const dashboardUrl = `${getBase44ApiUrl()}/apps/${projectId}/editor/preview`;

  log.message(`${chalk.dim("Project")}: ${orange(name.trim())}`);
  log.message(`${chalk.dim("Dashboard")}: ${cyan(dashboardUrl)}`);

  outro("All set and ready!");
}

export const createCommand = new Command("create")
  .description("Create a new Base44 project")
  .action(async () => {
    await runCommand(create, { fullBanner: true, requireAuth: true });
  });
