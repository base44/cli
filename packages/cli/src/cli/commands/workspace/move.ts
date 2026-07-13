import type { Option as PromptOption } from "@clack/prompts";
import { confirm, isCancel, select } from "@clack/prompts";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, onPromptCancel, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  canCreateAppsInWorkspace,
  getApp,
  getAppContext,
  listWorkspaces,
  moveAppToWorkspace,
  type WorkspaceListEntry,
} from "@/core/index.js";
import { toJsonStdout } from "./shared.js";

interface MoveOptions {
  disconnectIntegrations?: boolean;
  yes?: boolean;
}

function workspaceName(
  workspaces: WorkspaceListEntry[],
  id: string | undefined,
): string {
  if (!id) return "unknown workspace";
  return workspaces.find((w) => w.id === id)?.name ?? id;
}

/**
 * Resolve the target workspace for a move: validate an explicit id, prompt when
 * interactive, or fail fast in non-interactive mode without one.
 */
async function resolveTargetWorkspace(
  target: string | undefined,
  workspaces: WorkspaceListEntry[],
  currentWorkspaceId: string | undefined,
  isInteractive: boolean,
): Promise<string> {
  const eligible = workspaces.filter(
    (w) => canCreateAppsInWorkspace(w.userRole) && w.id !== currentWorkspaceId,
  );

  if (target) {
    const match = workspaces.find((w) => w.id === target);
    if (!match) {
      throw new InvalidInputError(
        `Workspace "${target}" not found, or you are not a member of it.`,
        {
          hints: [
            { message: "Run 'base44 workspace list' to see your workspaces" },
          ],
        },
      );
    }
    if (target === currentWorkspaceId) {
      throw new InvalidInputError("The app is already in that workspace.");
    }
    if (!canCreateAppsInWorkspace(match.userRole)) {
      throw new InvalidInputError(
        `You don't have permission to move apps into workspace "${match.name}" (your role: ${match.userRole ?? "unknown"}).`,
      );
    }
    return match.id;
  }

  if (!isInteractive) {
    throw new InvalidInputError(
      "A target workspace ID is required in non-interactive mode.",
      {
        hints: [
          { message: "Usage: base44 workspace move <workspace-id>" },
          { message: "Run 'base44 workspace list' to see your workspaces" },
        ],
      },
    );
  }

  if (eligible.length === 0) {
    throw new InvalidInputError(
      "No other workspaces available to move this app into.",
    );
  }

  const options: PromptOption<string>[] = eligible.map((w) => ({
    value: w.id,
    label: `${w.name} (${w.userRole ?? "member"})`,
  }));
  const selected = await select({
    message: "Move the app to which workspace?",
    options,
  });
  if (isCancel(selected)) {
    onPromptCancel();
  }
  return selected as string;
}

async function moveAction(
  ctx: CLIContext,
  target: string | undefined,
  options: MoveOptions,
): Promise<RunCommandResult> {
  const { runTask, isNonInteractive, jsonMode } = ctx;
  const isInteractive = !isNonInteractive && !jsonMode;
  const { id: appId } = getAppContext();

  const { workspaces, currentWorkspaceId } = await runTask(
    "Fetching workspaces...",
    async () => {
      const [workspaces, app] = await Promise.all([
        listWorkspaces(),
        getApp(appId),
      ]);
      return { workspaces, currentWorkspaceId: app.organizationId };
    },
    { errorMessage: "Failed to fetch workspaces" },
  );

  const targetWorkspaceId = await resolveTargetWorkspace(
    target,
    workspaces,
    currentWorkspaceId,
    isInteractive,
  );

  if (isInteractive && !options.yes) {
    const proceed = await confirm({
      message: `Move this app from ${theme.styles.bold(
        workspaceName(workspaces, currentWorkspaceId),
      )} to ${theme.styles.bold(workspaceName(workspaces, targetWorkspaceId))}?`,
    });
    if (isCancel(proceed)) {
      onPromptCancel();
    }
    if (!proceed) {
      return { outroMessage: "Move cancelled" };
    }
  }

  const result = await runTask(
    "Moving app to workspace...",
    () =>
      moveAppToWorkspace(appId, targetWorkspaceId, {
        disconnectIntegrations: options.disconnectIntegrations,
      }),
    { errorMessage: "Failed to move app" },
  );

  const targetName = workspaceName(workspaces, targetWorkspaceId);
  if (jsonMode) {
    return {
      outroMessage: `App moved to ${targetName}`,
      stdout: toJsonStdout(result),
    };
  }

  return { outroMessage: `App moved to ${theme.styles.bold(targetName)}` };
}

export function getWorkspaceMoveCommand(): Command {
  return new Base44Command("move")
    .description("Move the current app to another workspace")
    .argument("[workspace-id]", "Target workspace (organization) ID")
    .option(
      "--disconnect-integrations",
      "Disconnect the app's OAuth integrations as part of the move",
    )
    .option("-y, --yes", "Skip the confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  $ base44 workspace move 507f1f77bcf86cd799439011      Move the linked app to the given workspace
  $ base44 workspace move --app-id <id> <workspace-id>  Move a specific app`,
    )
    .action(moveAction);
}
