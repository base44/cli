import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme, toJsonStdout } from "@/cli/utils/index.js";
import { listWorkspaces } from "@/core/index.js";
import { workspaceTag } from "./shared.js";

interface ListOptions {
  role?: string;
}

async function listWorkspacesAction(
  { log, runTask, jsonMode }: CLIContext,
  options: ListOptions,
): Promise<RunCommandResult> {
  let workspaces = await runTask(
    "Fetching workspaces...",
    () => listWorkspaces(),
    { errorMessage: "Failed to fetch workspaces" },
  );

  if (options.role) {
    const role = options.role.toLowerCase();
    workspaces = workspaces.filter((w) => w.userRole?.toLowerCase() === role);
  }

  const summary = `${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""}`;

  if (jsonMode) {
    return { outroMessage: summary, stdout: toJsonStdout(workspaces) };
  }

  for (const workspace of workspaces) {
    log.message(
      `  ${theme.styles.bold(workspace.name)} ${theme.styles.dim(`[${workspaceTag(workspace)}]`)}\n  ${theme.styles.dim(workspace.id)}`,
    );
  }

  return { outroMessage: summary };
}

export function getWorkspaceListCommand(): Command {
  return new Base44Command("list", { requireAppContext: false })
    .description("List the workspaces you belong to")
    .option(
      "--role <role>",
      "Only workspaces where your role matches (owner, admin, editor, viewer)",
    )
    .action(listWorkspacesAction);
}
