import type { Option as PromptOption } from "@clack/prompts";
import { isCancel, select } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { onPromptCancel } from "@/cli/utils/index.js";
import { ApiError } from "@/core/errors.js";
import { listWorkspaces, type WorkspaceListEntry } from "@/core/index.js";

/**
 * A CLI credential that is scoped to a single workspace (e.g. a workspace API
 * key, or a login completed inside a workspace) can't call the account-level
 * `GET /api/workspace/workspaces` endpoint — the server rejects it with a 403.
 * The workspace picker is only a convenience, so we treat this as "can't list"
 * and fall back to the default workspace rather than failing the command.
 */
function isWorkspaceListForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 403;
}

/**
 * Fetch the workspaces the user belongs to, or `null` when the current
 * credential isn't allowed to list them (see {@link isWorkspaceListForbidden}).
 */
function fetchWorkspaces(
  ctx: CLIContext,
): Promise<WorkspaceListEntry[] | null> {
  return ctx.runTask(
    "Fetching workspaces...",
    async (updateMessage) => {
      try {
        return await listWorkspaces();
      } catch (error) {
        if (isWorkspaceListForbidden(error)) {
          updateMessage("Using your default workspace");
          return null;
        }
        throw error;
      }
    },
    {
      successMessage: "Workspaces checked",
      errorMessage: "Failed to fetch workspaces",
    },
  );
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
 * - interactive but the credential can't list workspaces (workspace-scoped):
 *   warn and fall back to the default workspace; `--workspace <id>` still works.
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
  if (workspaces === null) {
    // Credential can't list workspaces (scoped to one). Use the default
    // workspace, and point the user at --workspace for a specific one.
    ctx.log.warn(
      "Couldn't list your workspaces with this login, so the default workspace will be used. Pass --workspace <id> to target a specific one.",
    );
    return undefined;
  }
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
