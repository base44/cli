import { Command } from "commander";
import { log, group, text, select, isCancel, cancel } from "@clack/prompts";
import type { Option } from "@clack/prompts";
import {
  findProjectRoot,
  createProject,
  writeAppConfig,
  appConfigExists,
  setAppConfig,
  fetchLinkableApps,
} from "@core/project/index.js";
import type { App } from "@core/project/index.js";
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
  existing?: string;
  name?: string;
  description?: string;
}

type LinkAction = "create" | "choose";

function validateNonInteractiveFlags(command: Command): void {
  const { create, existing, name } = command.opts<LinkOptions>();
  if (create && existing) {
    command.error("--create and --existing cannot be used together");
  }
  if (create && !name) {
    command.error("--name is required when using --create");
  }
}

async function promptForLinkAction(linkableApps: App[]): Promise<LinkAction> {
  const actionOptions: Array<Option<LinkAction>> = [
    {
      value: "create",
      label: "Create a new project",
      hint: "Create a new Base44 project and link it",
    },
  ];

  if (linkableApps.length > 0) {
    actionOptions.push({
      value: "choose",
      label: "Link an existing project",
      hint: `Choose from ${linkableApps.length} available project${linkableApps.length === 1 ? "" : "s"}`,
    });
  }

  const action = await select({
    message: "How would you like to link this project?",
    options: actionOptions,
  });

  if (isCancel(action)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return action as LinkAction;
}

async function promptForNewProjectDetails() {
  const result = await group(
    {
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

async function promptForExistingApp(linkableApps: App[]): Promise<App> {
  const appOptions: Array<Option<App>> = linkableApps.map((app) => ({
    value: app,
    label: app.name,
  }));

  const selectedApp = await select({
    message: "Choose a project to link",
    options: appOptions,
  });

  if (isCancel(selectedApp)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return selectedApp as App;
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

  // Handle non-interactive mode with --existing flag
  if (options.existing) {
    await writeAppConfig(projectRoot.root, options.existing);
    setAppConfig({ id: options.existing, projectRoot: projectRoot.root });
    log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(options.existing))}`);
    return { outroMessage: "Project linked" };
  }

  // Handle non-interactive mode with --create flag
  if (options.create) {
    const { projectId } = await runTask(
      "Creating project on Base44...",
      async () => {
        return await createProject(options.name!.trim(), options.description?.trim());
      },
      {
        successMessage: "Project created successfully",
        errorMessage: "Failed to create project",
      }
    );

    await writeAppConfig(projectRoot.root, projectId);
    setAppConfig({ id: projectId, projectRoot: projectRoot.root });
    log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(projectId))}`);
    return { outroMessage: "Project linked" };
  }

  // Interactive mode: fetch linkable apps and prompt for action
  const linkableApps = await runTask(
    "Fetching your projects...",
    async () => fetchLinkableApps(),
    {
      successMessage: `Found ${theme.colors.base44Orange("projects")} available for linking`,
      errorMessage: "Failed to fetch projects",
    }
  );

  const action = await promptForLinkAction(linkableApps);

  if (action === "choose") {
    const selectedApp = await promptForExistingApp(linkableApps);
    await writeAppConfig(projectRoot.root, selectedApp.id);
    setAppConfig({ id: selectedApp.id, projectRoot: projectRoot.root });
    log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(selectedApp.id))}`);
    return { outroMessage: "Project linked" };
  }

  // action === "create"
  const { name, description } = await promptForNewProjectDetails();

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
  setAppConfig({ id: projectId, projectRoot: projectRoot.root });
  log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(projectId))}`);

  return { outroMessage: "Project linked" };
}

export const linkCommand = new Command("link")
  .description("Link a local project to a Base44 project")
  .option("-c, --create", "Create a new project (skip selection prompt)")
  .option("-e, --existing <id>", "Link to an existing project by ID (skip selection prompt)")
  .option("-n, --name <name>", "Project name (required when --create is used)")
  .option("-d, --description <description>", "Project description")
  .hook("preAction", validateNonInteractiveFlags)
  .action(async (options: LinkOptions) => {
    await runCommand(() => link(options), { requireAuth: true, requireAppConfig: false });
  });
