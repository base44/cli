import { getBase44ApiUrl } from "@/core/config.js";

/**
 * Gets the dashboard URL for a project.
 *
 * @param projectId - Project ID (required)
 * @returns The dashboard URL
 */
export function getDashboardUrl(projectId: string): string {
  return `${getBase44ApiUrl()}/apps/${projectId}/editor/workspace/overview`;
}
