import { getBase44ApiUrl, getBase44ClientId } from "@core/config.js";

/**
 * Gets the dashboard URL for a project.
 *
 * @param projectId - Optional project ID. If not provided, uses BASE44_CLIENT_ID from env.
 * @returns The dashboard URL
 * @throws Error if no projectId provided and BASE44_CLIENT_ID is not configured
 */
export function getDashboardUrl(projectId?: string): string {
  const id = projectId ?? getBase44ClientId();

  if (!id) {
    throw new Error(
      "App not configured. BASE44_CLIENT_ID environment variable is required. Set it in your .env.local file."
    );
  }

  return `${getBase44ApiUrl()}/apps/${id}/editor/workspace/overview`;
}
