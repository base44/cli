import type { Option as PromptOption } from "@clack/prompts";
import { isCancel, select } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { onPromptCancel } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  canCreateAppsInWorkspace,
  listWorkspaces,
  type WorkspaceListEntry,
} from "@/core/index.js";

function fetchWorkspaces(ctx: CLIContext): Promise<WorkspaceListEntry[]> {
  return ctx.runTask("Fetching workspaces...", () => listWorkspaces(), {
    successMessage: "Workspaces fetched",
    errorMessage: "Failed to fetch workspaces",
  });
}

function workspaceHints(workspaces: WorkspaceListEntry[]) {
  return [
    { message: "Run 'base44 workspace list' to see available workspaces" },
    ...workspaces
      .filter((w) => canCreateAppsInWorkspace(w.userRole))
      .map((w) => ({ message: `${w.name} — ${w.id}` })),
  ];
}

function workspaceLabel(workspace: WorkspaceListEntry): string {
  const suffix = workspace.isPersonal
    ? "personal"
    : (workspace.userRole ?? "member");
  return `${workspace.name} (${suffix})`;
}

/**
 * Resolve the workspace a new app should belong to.
 *
 * - `--workspace <id>` set: validate membership + create permission, return it.
 * - interactive with more than one eligible workspace: prompt to pick.
 * - otherwise: return `undefined` so the server defaults to the personal
 *   workspace (no extra API call, no prompt for the common single-workspace case).
 */
export async function resolveWorkspaceId(
  ctx: CLIContext,
  flagWorkspaceId: string | undefined,
  isInteractive: boolean,
): Promise<string | undefined> {
  if (flagWorkspaceId) {
    const workspaces = await fetchWorkspaces(ctx);
    const match = workspaces.find((w) => w.id === flagWorkspaceId);
    if (!match) {
      throw new InvalidInputError(
        `Workspace "${flagWorkspaceId}" not found, or you are not a member of it.`,
        { hints: workspaceHints(workspaces) },
      );
    }
    if (!canCreateAppsInWorkspace(match.userRole)) {
      throw new InvalidInputError(
        `You don't have permission to create apps in workspace "${match.name}" (your role: ${match.userRole ?? "unknown"}).`,
      );
    }
    return match.id;
  }

  if (!isInteractive) {
    return undefined;
  }

  const workspaces = await fetchWorkspaces(ctx);
  const eligible = workspaces.filter((w) =>
    canCreateAppsInWorkspace(w.userRole),
  );
  if (eligible.length <= 1) {
    // Only the personal workspace (or none surfaced) — nothing to choose.
    return undefined;
  }

  const options: PromptOption<string>[] = eligible.map((w) => ({
    value: w.id,
    label: workspaceLabel(w),
  }));

  const selected = await select({
    message: "Which workspace should this app belong to?",
    options,
    initialValue: eligible[0].id,
  });

  if (isCancel(selected)) {
    onPromptCancel();
  }

  return selected as string;
}
