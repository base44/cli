import { getBase44ApiUrl } from "@/core/config.js";

/**
 * Gets the dashboard URL for a project.
 *
 * @param projectId - The project ID
 * @returns The dashboard URL
 */
export function getDashboardUrl(projectId: string): string {
  return `${getBase44ApiUrl()}/apps/${projectId}/editor/workspace/overview`;
}
