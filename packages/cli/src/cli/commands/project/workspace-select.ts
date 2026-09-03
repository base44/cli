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
 * Resolve which workspace a command should target (creating an app in it, or
 * scoping the app list for `link`). The server is the source of truth for
 * permissions — the CLI never filters or validates by role:
 *
 * - `--workspace <id>` set: pass it straight through; the server returns a clear
 *   error if you can't use it.
 * - interactive with more than one workspace: prompt to pick (no role filter;
 *   personal first).
 * - otherwise: return `undefined` so the server defaults to the personal
 *   workspace (no extra API call in the common single-workspace case).
 */
export async function resolveWorkspaceId(
  ctx: CLIContext,
  flagWorkspaceId: string | undefined,
  isInteractive: boolean,
  options: { promptMessage?: string } = {},
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

  const promptOptions: PromptOption<string>[] = workspaces.map((w) => ({
    value: w.id,
    label: workspaceLabel(w),
  }));

  const selected = await select({
    message:
      options.promptMessage ?? "Which workspace should this app belong to?",
    options: promptOptions,
    initialValue: workspaces[0].id,
  });

  if (isCancel(selected)) {
    onPromptCancel();
  }

  return selected as string;
}
