import { z } from "zod";
import { getBase44ApiUrl } from "@/core/config.js";
import { getAppConfig } from "@/core/project/index.js";
import { base44Client } from "@/core/clients/index.js";

const PublishedUrlResponseSchema = z.object({
  url: z.string(),
});

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

/**
 * Gets the published site URL for a project by calling the API.
 *
 * @param projectId - Optional project ID. If not provided, uses cached appId from getAppConfig().
 * @returns The published site URL (e.g., https://myapp.base44.app)
 * @throws Error if no projectId provided and app config is not initialized, or if app has no slug
 */
export async function getSiteUrl(projectId?: string): Promise<string> {
  const id = projectId ?? getAppConfig().id;
  const response = await base44Client.get(`api/apps/platform/${id}/published-url`);
  const data = PublishedUrlResponseSchema.parse(await response.json());
  return data.url;
}
