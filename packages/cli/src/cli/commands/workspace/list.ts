import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { listWorkspaces } from "@/core/index.js";
import { toJsonStdout, workspaceTag } from "./shared.js";

async function listWorkspacesAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  const workspaces = await runTask(
    "Fetching workspaces...",
    () => listWorkspaces(),
    { errorMessage: "Failed to fetch workspaces" },
  );

  if (jsonMode) {
    return {
      outroMessage: `${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""}`,
      stdout: toJsonStdout(workspaces),
    };
  }

  for (const workspace of workspaces) {
    log.message(
      `  ${theme.styles.bold(workspace.name)} ${theme.styles.dim(`[${workspaceTag(workspace)}]`)}\n  ${theme.styles.dim(workspace.id)}`,
    );
  }

  return {
    outroMessage: `${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""}`,
  };
}

export function getWorkspaceListCommand(): Command {
  return new Base44Command("list", { requireAppContext: false })
    .description("List the workspaces you belong to")
    .action(listWorkspacesAction);
}
