import type { Option } from "@clack/prompts";
import { cancel, group, isCancel, log, select, text } from "@clack/prompts";
import { Command } from "commander";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext } from "@/cli/types.js";
import {
  getDashboardUrl,
  onPromptCancel,
  runCommand,
  runTask,
  theme,
} from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
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
  setAppConfig,
  writeAppConfig,
} from "@/core/project/index.js";

interface LinkOptions {
  create?: boolean;
  name?: string;
  description?: string;
  projectId?: string;
}

type LinkAction = "create" | "choose";

function validateNonInteractiveFlags(command: Command): void {
  const { create, name, projectId } = command.opts<LinkOptions>();

  if (create && projectId) {
    command.error("--create and --projectId cannot be used together");
  }

  if (create && !name) {
    command.error("--name is required when using --create");
  }
}

async function promptForLinkAction(): Promise<LinkAction> {
  const actionOptions: Option<LinkAction>[] = [
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
    }
  );

  return {
    name: result.name.trim(),
    description: result.description ? result.description.trim() : undefined,
  };
}

async function promptForExistingProject(
  linkableProjects: Project[]
): Promise<Project> {
  const projectOptions: Option<Project>[] = linkableProjects.map((project) => ({
    value: project,
    label: project.name,
  }));

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

async function link(options: LinkOptions): Promise<RunCommandResult> {
  const projectRoot = await findProjectRoot();

  if (!projectRoot) {
    throw new ConfigNotFoundError(
      "No Base44 project found. Run this command from a project directory with a config.jsonc file."
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
      }
    );
  }

  let finalProjectId: string | undefined;
  const action = options.projectId
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
      }
    );

    const linkableProjects = projects.filter(
      (p) => p.isManagedSourceCode !== true
    );

    if (!linkableProjects.length) {
      return { outroMessage: "No projects available for linking" };
    }

    let projectId: string;

    if (options.projectId) {
      // Validate that the provided project ID exists and is linkable
      const project = linkableProjects.find((p) => p.id === options.projectId);
      if (!project) {
        throw new InvalidInputError(
          `Project with ID "${options.projectId}" not found or not available for linking.`,
          {
            hints: [
              { message: "Check the project ID is correct" },
              {
                message:
                  "Use 'base44 link' without --projectId to see available projects",
              },
            ],
          }
        );
      }
      projectId = options.projectId;
    } else {
      const selectedProject = await promptForExistingProject(linkableProjects);
      projectId = selectedProject.id;
    }

    await runTask(
      "Linking project...",
      async () => {
        await writeAppConfig(projectRoot.root, projectId);
        setAppConfig({ id: projectId, projectRoot: projectRoot.root });
      },
      {
        successMessage: "Project linked successfully",
        errorMessage: "Failed to link project",
      }
    );

    finalProjectId = projectId;
  }

  if (action === "create") {
    const { name, description } = options.create
      ? { name: options.name!.trim(), description: options.description?.trim() }
      : await promptForNewProjectDetails();

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

    finalProjectId = projectId;
  }

  log.message(
    `${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(finalProjectId))}`
  );
  return { outroMessage: "Project linked" };
}

export function getLinkCommand(context: CLIContext): Command {
  return new Command("link")
    .description(
      "Link a local project to a Base44 project (create new or link existing)"
    )
    .option("-c, --create", "Create a new project (skip selection prompt)")
    .option(
      "-n, --name <name>",
      "Project name (required when --create is used)"
    )
    .option("-d, --description <description>", "Project description")
    .option(
      "-p, --projectId <id>",
      "Project ID to link to an existing project (skips selection prompt)"
    )
    .hook("preAction", validateNonInteractiveFlags)
    .action(async (options: LinkOptions) => {
      await runCommand(
        () => link(options),
        { requireAuth: true, requireAppConfig: false },
        context
      );
    });
}
