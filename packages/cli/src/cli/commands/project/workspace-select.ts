import type { Option as PromptOption } from "@clack/prompts";
import { isCancel, select } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { onPromptCancel } from "@/cli/utils/index.js";
import { listWorkspaces, type WorkspaceListEntry } from "@/core/index.js";

function fetchWorkspaces(ctx: CLIContext): Promise<WorkspaceListEntry[]> {
  return ctx.runTask("Fetching workspaces...", () => listWorkspaces(), {
    successMessage: "Workspaces fetched",
    errorMessage: "Failed to fetch workspaces",
  });
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
 * - `--workspace <id>` set: pass it straight through — the server authorizes
 *   creation in that workspace and returns a clear error if you can't.
 * - interactive with more than one workspace: prompt to pick (no role filter;
 *   personal first). The server rejects a workspace you can't create in.
 * - otherwise: return `undefined` so the server defaults to the personal
 *   workspace (no extra API call in the common single-workspace case).
 */
export async function resolveWorkspaceId(
  ctx: CLIContext,
  flagWorkspaceId: string | undefined,
  isInteractive: boolean,
): Promise<string | undefined> {
  if (flagWorkspaceId) {
    return flagWorkspaceId;
  }

  if (!isInteractive) {
    return undefined;
  }

  const workspaces = await fetchWorkspaces(ctx);
  if (workspaces.length <= 1) {
    // Only the personal workspace — nothing to choose.
    return undefined;
  }

  const options: PromptOption<string>[] = workspaces.map((w) => ({
    value: w.id,
    label: workspaceLabel(w),
  }));

  const selected = await select({
    message: "Which workspace should this app belong to?",
    options,
    initialValue: workspaces[0].id,
  });

  if (isCancel(selected)) {
    onPromptCancel();
  }

  return selected as string;
}
