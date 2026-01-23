import { base44Client } from "@core/clients/index.js";
import { CreateProjectResponseSchema, AppsResponseSchema } from "./schema.js";
import type { App } from "./schema.js";

export async function createProject(projectName: string, description?: string) {
  const response = await base44Client.post("api/apps", {
    json: {
      name: projectName,
      user_description: description ?? `Backend for '${projectName}'`,
      is_managed_source_code: false,
      public_settings: "public_without_login"
    },
  });

  const result = CreateProjectResponseSchema.parse(await response.json());

  return {
    projectId: result.id,
  };
}

export async function fetchApps(): Promise<App[]> {
  const response = await base44Client.get("api/apps");
  const apps = AppsResponseSchema.parse(await response.json());
  return apps;
}

export async function fetchLinkableApps(): Promise<App[]> {
  const apps = await fetchApps();
  // Filter for apps explicitly marked as CLI-managed (is_managed_source_code === false)
  // Apps with undefined are treated as AI-managed and not linkable
  return apps.filter((app) => app.is_managed_source_code === false);
}
