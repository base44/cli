import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme, toJsonStdout } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { getWorkspace } from "@/core/index.js";
import { workspaceTag } from "./shared.js";

async function getWorkspaceAction(
  { runTask, log, jsonMode }: CLIContext,
  workspaceId: string,
): Promise<RunCommandResult> {
  const workspace = await runTask(
    "Fetching workspace...",
    () => getWorkspace(workspaceId),
    { errorMessage: "Failed to fetch workspace" },
  );

  if (!workspace) {
    throw new InvalidInputError(
      `Workspace "${workspaceId}" not found, or you are not a member of it.`,
      {
        hints: [
          { message: "Run 'base44 workspace list' to see your workspaces" },
        ],
      },
    );
  }

  if (jsonMode) {
    return {
      outroMessage: workspace.name,
      stdout: toJsonStdout(workspace),
    };
  }

  log.message(
    `  ${theme.styles.bold(workspace.name)} ${theme.styles.dim(`[${workspaceTag(workspace)}]`)}\n  ${theme.styles.dim(workspace.id)}${
      workspace.subscriptionTier
        ? theme.styles.dim(`\n  tier: ${workspace.subscriptionTier}`)
        : ""
    }`,
  );

  return { outroMessage: workspace.name };
}

export function getWorkspaceGetCommand(): Command {
  return new Base44Command("get", { requireAppContext: false })
    .description("Show details for a single workspace by ID")
    .argument("<workspace-id>", "Workspace (organization) ID")
    .action(getWorkspaceAction);
}
