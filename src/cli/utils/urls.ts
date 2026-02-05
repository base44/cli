import { getBase44ApiUrl } from "@/core/config.js";
import { getAppConfig } from "@/core/project/index.js";

/**
 * Gets the dashboard URL for a project.
 *
 * @param projectId - Optional project ID. If not provided, uses cached appId from getAppConfig().
 * @returns The dashboard URL
 * @throws Error if no projectId provided and app config is not initialized
 */
export function getDashboardUrl(projectId?: string): string {
  const id = projectId ?? getAppConfig().id;
  return `${getBase44ApiUrl()}/apps/${id}/editor/workspace/overview`;
}
