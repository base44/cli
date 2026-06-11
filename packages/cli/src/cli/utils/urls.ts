import { getBase44ApiUrl } from "@/core/config.js";
import { getAppContext } from "@/core/project/index.js";

/**
 * Gets the dashboard URL for a project.
 *
 * @param projectId - Optional project ID. If not provided, uses cached appId from getAppContext().
 * @returns The dashboard URL
 * @throws Error if no projectId provided and app context is not initialized
 */
export function getDashboardUrl(projectId?: string): string {
  const id = projectId ?? getAppContext().id;
  return `${getBase44ApiUrl()}/apps/${id}/editor/workspace/overview`;
}

export function getConnectorsUrl(projectId?: string): string {
  const id = projectId ?? getAppContext().id;
  return `${getBase44ApiUrl()}/apps/${id}/editor/workspace/app-connections`;
}
