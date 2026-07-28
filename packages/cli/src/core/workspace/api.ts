import type { KyResponse } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type { MoveAppResult, Workspace } from "@/core/workspace/schema.js";
import {
  MoveAppResponseSchema,
  WorkspaceListResponseSchema,
} from "@/core/workspace/schema.js";

export interface WorkspaceListEntry extends Workspace {
  /**
   * The user's personal workspace. The server returns it first (the builder
   * auto-selects `workspaces[0]`), so the first entry is the personal one.
   */
  isPersonal: boolean;
}

/**
 * List every workspace the current user belongs to. The first entry is the
 * user's personal workspace (flagged via {@link WorkspaceListEntry.isPersonal}).
 */
export async function listWorkspaces(): Promise<WorkspaceListEntry[]> {
  let response: KyResponse;
  try {
    response = await base44Client.get("api/workspace/workspaces");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing workspaces");
  }

  const result = WorkspaceListResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data.workspaces.map((workspace, index) => ({
    ...workspace,
    isPersonal: index === 0,
  }));
}

/**
 * Fetch a single workspace the current user belongs to, by ID. Returns
 * `undefined` when the user is not a member of a workspace with that ID.
 * Backed by {@link listWorkspaces} — there is no per-workspace GET the CLI
 * principal is authorized for, and reusing the list keeps the shape identical.
 */
export async function getWorkspace(
  id: string,
): Promise<WorkspaceListEntry | undefined> {
  const workspaces = await listWorkspaces();
  return workspaces.find((w) => w.id === id);
}

/**
 * Move an existing app to another workspace. The caller must be an editor of
 * both the source (per its transfer policy) and the target workspace; the
 * server enforces this and returns a 403 otherwise.
 */
export async function moveAppToWorkspace(
  appId: string,
  targetWorkspaceId: string,
  options: { disconnectIntegrations?: boolean } = {},
): Promise<MoveAppResult> {
  let response: KyResponse;
  try {
    response = await base44Client.post(
      `api/apps/${appId}/metadata/move-to-workspace`,
      {
        json: {
          target_workspace_id: targetWorkspaceId,
          disconnect_integrations: options.disconnectIntegrations ?? false,
        },
      },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "moving app to workspace");
  }

  const result = MoveAppResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
