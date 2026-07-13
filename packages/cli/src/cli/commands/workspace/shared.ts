import type { WorkspaceListEntry } from "@/core/index.js";

/** Serialize a value as pretty JSON for stdout (the `--json` contract). */
export function toJsonStdout(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Short human-readable role/personal tag for a workspace, e.g. "personal, owner". */
export function workspaceTag(workspace: WorkspaceListEntry): string {
  const role = workspace.userRole ?? "member";
  return workspace.isPersonal ? `personal, ${role}` : role;
}
