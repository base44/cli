import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { canCreateAppsInWorkspace, listWorkspaces } from "@/core/index.js";
import { toJsonStdout, workspaceTag } from "./shared.js";

interface ListOptions {
  canCreate?: boolean;
  role?: string;
}

function pluralize(n: number): string {
  return `${n} workspace${n !== 1 ? "s" : ""}`;
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

  if (options.canCreate) {
    workspaces = workspaces.filter((w) => canCreateAppsInWorkspace(w.userRole));
  }
  if (options.role) {
    const role = options.role.toLowerCase();
    workspaces = workspaces.filter((w) => w.userRole?.toLowerCase() === role);
  }

  if (jsonMode) {
    return {
      outroMessage: pluralize(workspaces.length),
      stdout: toJsonStdout(workspaces),
    };
  }

  for (const workspace of workspaces) {
    log.message(
      `  ${theme.styles.bold(workspace.name)} ${theme.styles.dim(`[${workspaceTag(workspace)}]`)}\n  ${theme.styles.dim(workspace.id)}`,
    );
  }

  return { outroMessage: pluralize(workspaces.length) };
}

export function getWorkspaceListCommand(): Command {
  return new Base44Command("list", { requireAppContext: false })
    .description("List the workspaces you belong to")
    .option(
      "--can-create",
      "Only workspaces you can create or move apps into (owner/admin/editor)",
    )
    .option(
      "--role <role>",
      "Only workspaces where your role matches (owner, admin, editor, viewer)",
    )
    .action(listWorkspacesAction);
}
