import type { Option as PromptOption } from "@clack/prompts";
import { confirm, isCancel, select } from "@clack/prompts";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  onPromptCancel,
  theme,
  toJsonStdout,
} from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  getApp,
  getAppContext,
  listWorkspaces,
  moveAppToWorkspace,
} from "@/core/index.js";

interface MoveOptions {
  disconnectIntegrations?: boolean;
  yes?: boolean;
}

interface TargetSelection {
  targetWorkspaceId: string;
  fromName: string;
  toName: string;
}

/**
 * Interactive target selection: pick from every workspace you belong to except
 * the app's current one. No role filtering — the server authorizes the move and
 * returns a clear reason if it's not allowed (matches the web builder). Only
 * runs in interactive mode, so the workspace/app fetch happens only when needed.
 */
async function promptForTargetWorkspace(
  ctx: CLIContext,
  appId: string,
): Promise<TargetSelection> {
  const { workspaces, currentWorkspaceId } = await ctx.runTask(
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

  const destinations = workspaces.filter((w) => w.id !== currentWorkspaceId);
  if (destinations.length === 0) {
    throw new InvalidInputError(
      "No other workspaces available to move this app into.",
    );
  }

  const options: PromptOption<string>[] = destinations.map((w) => ({
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
  const targetWorkspaceId = selected as string;

  const nameOf = (id: string | undefined): string =>
    workspaces.find((w) => w.id === id)?.name ?? id ?? "unknown workspace";
  return {
    targetWorkspaceId,
    fromName: nameOf(currentWorkspaceId),
    toName: nameOf(targetWorkspaceId),
  };
}

async function moveAction(
  ctx: CLIContext,
  target: string | undefined,
  options: MoveOptions,
): Promise<RunCommandResult> {
  const { runTask, isNonInteractive, jsonMode } = ctx;
  const isInteractive = !isNonInteractive && !jsonMode;
  const { id: appId } = getAppContext();

  let targetWorkspaceId: string;
  let toLabel: string;

  if (target) {
    // Explicit target: don't pre-validate — the server authorizes the move and
    // surfaces any block reason (e.g. "Only workspace admins and owners can
    // move apps out of this workspace").
    targetWorkspaceId = target;
    toLabel = target;
    if (isInteractive && !options.yes) {
      const proceed = await confirm({
        message: `Move this app to workspace ${theme.styles.bold(target)}?`,
      });
      if (isCancel(proceed)) {
        onPromptCancel();
      }
      if (!proceed) {
        return { outroMessage: "Move cancelled" };
      }
    }
  } else if (isInteractive) {
    const picked = await promptForTargetWorkspace(ctx, appId);
    targetWorkspaceId = picked.targetWorkspaceId;
    toLabel = picked.toName;
    if (!options.yes) {
      const proceed = await confirm({
        message: `Move this app from ${theme.styles.bold(picked.fromName)} to ${theme.styles.bold(picked.toName)}?`,
      });
      if (isCancel(proceed)) {
        onPromptCancel();
      }
      if (!proceed) {
        return { outroMessage: "Move cancelled" };
      }
    }
  } else {
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

  const result = await runTask(
    "Moving app to workspace...",
    () =>
      moveAppToWorkspace(appId, targetWorkspaceId, {
        disconnectIntegrations: options.disconnectIntegrations,
      }),
    { errorMessage: "Failed to move app" },
  );

  if (jsonMode) {
    return { outroMessage: "App moved", stdout: toJsonStdout(result) };
  }

  return { outroMessage: `App moved to ${theme.styles.bold(toLabel)}` };
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
