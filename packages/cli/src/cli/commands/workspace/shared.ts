import type { WorkspaceListEntry } from "@/core/index.js";

/** Short human-readable role/personal tag for a workspace, e.g. "personal, owner". */
export function workspaceTag(workspace: WorkspaceListEntry): string {
  const role = workspace.userRole ?? "member";
  return workspace.isPersonal ? `personal, ${role}` : role;
}
