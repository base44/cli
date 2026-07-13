import type { Option as PromptOption } from "@clack/prompts";
import { cancel, group, isCancel, select, text } from "@clack/prompts";
import { type Command, Option as CommanderOption } from "commander";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  getDashboardUrl,
  onPromptCancel,
  theme,
} from "@/cli/utils/index.js";
import {
  ConfigExistsError,
  ConfigNotFoundError,
  InvalidInputError,
} from "@/core/errors.js";
import type { Project } from "@/core/project/index.js";
import {
  appConfigExists,
  createProject,
  findProjectRoot,
  listProjects,
  setAppContext,
  writeAppConfig,
} from "@/core/project/index.js";
import { readExplicitAppId } from "./app-id-options.js";
import { resolveWorkspaceId } from "./workspace-select.js";

interface LinkOptions {
  create?: boolean;
  name?: string;
  description?: string;
  workspace?: string;
  org?: string;
}

type LinkAction = "create" | "choose";

function validateNonInteractiveFlags(command: Command): void {
  const { create, name } = command.opts<LinkOptions>();
  const {
    appId,
    legacyProjectId,
    value: selectedAppId,
  } = readExplicitAppId(command);
  if (appId && legacyProjectId) {
    command.error("--app-id and --project-id cannot be used together");
  }

  if (create && selectedAppId) {
    command.error("--create and --app-id cannot be used together");
  }

  if (create && !name) {
    command.error("--name is required when using --create");
  }
}

async function promptForLinkAction(): Promise<LinkAction> {
  const actionOptions: PromptOption<LinkAction>[] = [
    {
      value: "create",
      label: "Create a new project",
      hint: "Create a new Base44 project and link it",
    },
  ];

  actionOptions.push({
    value: "choose",
    label: "Link an existing project",
    hint: "Choose from one of your available projects previously created by the Base44 CLI",
  });

  const action = await select({
    message: "How would you like to link this project?",
    options: actionOptions,
  });

  if (isCancel(action)) {
    cancel("Operation cancelled.");
    throw new CLIExitError(0);
  }

  return action;
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
    },
  );

  return {
    name: result.name.trim(),
    description: result.description ? result.description.trim() : undefined,
  };
}

async function promptForExistingProject(
  linkableProjects: Project[],
): Promise<Project> {
  const projectOptions: PromptOption<Project>[] = linkableProjects.map(
    (project) => ({
      value: project,
      label: project.name,
    }),
  );

  const selectedProject = await select({
    message: "Choose a project to link",
    options: projectOptions,
  });

  if (isCancel(selectedProject)) {
    cancel("Operation cancelled.");
    throw new CLIExitError(0);
  }

  return selectedProject;
}

async function link(
  ctx: CLIContext,
  options: LinkOptions,
  command: Command,
): Promise<RunCommandResult> {
  const { log, runTask, isNonInteractive } = ctx;
  const appId = readExplicitAppId(command).value;

  const skipPrompts = !!options.create || !!appId;
  if (!skipPrompts && isNonInteractive) {
    throw new InvalidInputError(
      "--create with --name, or --app-id, is required in non-interactive mode",
    );
  }

  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    throw new ConfigNotFoundError(
      "No Base44 project found. Run this command from a project directory with a config.jsonc file.",
    );
  }

  if (await appConfigExists(projectRoot.root)) {
    throw new ConfigExistsError(
      "Project is already linked. An .app.jsonc file with the appId already exists.",
      {
        hints: [
          {
            message:
              "If you want to re-link, delete the existing .app.jsonc file first",
          },
        ],
      },
    );
  }

  let finalAppId: string | undefined;
  const action = appId
    ? "choose"
    : options.create
      ? "create"
      : await promptForLinkAction();

  if (action === "choose") {
    const projects = await runTask(
      "Fetching projects...",
      async () => listProjects(),
      {
        successMessage: "Projects fetched",
        errorMessage: "Failed to fetch projects",
      },
    );

    const linkableProjects = projects.filter(
      (p) => p.isManagedSourceCode !== true,
    );

    if (!linkableProjects.length) {
      return { outroMessage: "No projects available for linking" };
    }

    let linkedAppId: string;

    if (appId) {
      // Validate that the provided app ID exists and is linkable
      const project = linkableProjects.find((p) => p.id === appId);
      if (!project) {
        throw new InvalidInputError(
          `App with ID "${appId}" not found or not available for linking.`,
          {
            hints: [
              { message: "Check the app ID is correct" },
              {
                message:
                  "Use 'base44 link' without --app-id to see available projects",
              },
            ],
          },
        );
      }
      linkedAppId = appId;
    } else {
      const selectedProject = await promptForExistingProject(linkableProjects);
      linkedAppId = selectedProject.id;
    }

    await runTask(
      "Linking project...",
      async () => {
        await writeAppConfig(projectRoot.root, linkedAppId);
        setAppContext({ id: linkedAppId, projectRoot: projectRoot.root });
      },
      {
        successMessage: "Project linked successfully",
        errorMessage: "Failed to link project",
      },
    );

    finalAppId = linkedAppId;
  }

  if (action === "create") {
    const { name, description } = options.create
      ? { name: options.name!.trim(), description: options.description?.trim() }
      : await promptForNewProjectDetails();

    const organizationId = await resolveWorkspaceId(
      ctx,
      options.workspace ?? options.org,
      !isNonInteractive,
    );

    const { projectId } = await runTask(
      "Creating project on Base44...",
      async () => {
        return await createProject(name, description, organizationId);
      },
      {
        successMessage: "Project created successfully",
        errorMessage: "Failed to create project",
      },
    );

    await writeAppConfig(projectRoot.root, projectId);

    // Set app context in cache for sync access to getDashboardUrl
    setAppContext({ id: projectId, projectRoot: projectRoot.root });

    finalAppId = projectId;
  }

  log.message(
    `${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(finalAppId))}`,
  );
  return { outroMessage: "Project linked" };
}

export function getLinkCommand(): Command {
  return (
    new Base44Command("link", {
      requireAppContext: false,
    })
      .description(
        "Link a local project to a Base44 project (create new or link existing)",
      )
      .configureHelp({ showGlobalOptions: true })
      .option("-c, --create", "Create a new project (skip selection prompt)")
      .option(
        "-n, --name <name>",
        "Project name (required when --create is used)",
      )
      .option("-d, --description <description>", "Project description")
      .option(
        "-w, --workspace <id>",
        "Workspace (organization) ID to create the app in when using --create (defaults to your personal workspace)",
      )
      .addOption(
        new CommanderOption("--org <id>", "Alias for --workspace").hideHelp(),
      )
      // TODO: Remove legacy --project-id aliases once docs and Base44 CLI skills use --app-id.
      .addOption(
        new CommanderOption(
          "-p, --project-id <id>",
          "Project ID to link to an existing project",
        ).hideHelp(),
      )
      .addOption(
        new CommanderOption(
          "--projectId <id>",
          "Project ID to link to an existing project",
        ).hideHelp(),
      )
      .hook("preAction", validateNonInteractiveFlags)
      .action(link)
  );
}
