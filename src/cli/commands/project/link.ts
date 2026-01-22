import { Command } from "commander";
import { log, group, text, select } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import {
  findProjectRoot,
  createProject,
  writeAppConfig,
  appConfigExists,
  setAppConfig,
} from "@core/project/index.js";
import {
  runCommand,
  runTask,
  onPromptCancel,
  theme,
  getDashboardUrl,
} from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

interface LinkOptions {
  create?: boolean;
  name?: string;
  description?: string;
}

type LinkAction = "create" | "choose";

function validateNonInteractiveFlags(command: Command): void {
  const { create, name } = command.opts<LinkOptions>();
  if (create && !name) {
    command.error("--name is required when using --create");
  }
}

async function promptForProjectDetails() {
  const actionOptions: Array<Option<LinkAction>> = [
    {
      value: "create",
      label: "Create a new project",
      hint: "Create a new Base44 project and link it",
    },
  ];

  const result = await group(
    {
      action: () =>
        select({
          message: "How would you like to link this project?",
          options: actionOptions,
        }),
      name: () => {
        return text({
          message: "What is the name of your project?",
          placeholder: "my-app",
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return "Project name is required";
            }
          },
        });
      },
      description: () =>
        text({
          message: "Description (optional)",
          placeholder: "A brief description of your project",
        }),
    },
    {
      onCancel: onPromptCancel,
    }
  );

  return {
    name: result.name.trim(),
    description: result.description ? result.description.trim() : undefined,
  };
}

async function link(options: LinkOptions): Promise<RunCommandResult> {
  const projectRoot = await findProjectRoot();

  if (!projectRoot) {
    throw new Error(
      "No Base44 project found. Run this command from a project directory with a config.jsonc file."
    );
  }

  if (await appConfigExists(projectRoot.root)) {
    throw new Error(
      "Project is already linked. An .app.jsonc file with the appId already exists."
    );
  }

  // Get project details from options or prompts
  const { name, description } = options.create
    ? { name: options.name!.trim(), description: options.description?.trim() }
    : await promptForProjectDetails();

  const { projectId } = await runTask(
    "Creating project on Base44...",
    async () => {
      return await createProject(name, description);
    },
    {
      successMessage: "Project created successfully",
      errorMessage: "Failed to create project",
    }
  );

  await writeAppConfig(projectRoot.root, projectId);

  // Set app config in cache for sync access to getDashboardUrl
  setAppConfig({ id: projectId, projectRoot: projectRoot.root });

  log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(projectId))}`);

  return { outroMessage: "Project linked" };
}

export const linkCommand = new Command("link")
  .description("Link a local project to a Base44 project")
  .option("-c, --create", "Create a new project (skip selection prompt)")
  .option("-n, --name <name>", "Project name (required when --create is used)")
  .option("-d, --description <description>", "Project description")
  .hook("preAction", validateNonInteractiveFlags)
  .action(async (options: LinkOptions) => {
    await runCommand(() => link(options), { requireAuth: true, requireAppConfig: false });
  });
