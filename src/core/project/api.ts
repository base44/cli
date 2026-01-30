import { base44Client } from "@/core/clients/index.js";
import { CreateProjectResponseSchema, ProjectsResponseSchema } from "@/core/project/schema.js";
import type { ProjectsResponse } from "@/core/project/schema.js";
import { SchemaValidationError } from "@/core/errors.js";

export async function createProject(projectName: string, description?: string) {
  const response = await base44Client.post("api/apps", {
    json: {
      name: projectName,
      user_description: description ?? `Backend for '${projectName}'`,
      is_managed_source_code: false,
      public_settings: "public_without_login"
    },
  });

  const result = CreateProjectResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return {
    projectId: result.data.id,
  };
}

export async function listProjects(): Promise<ProjectsResponse> {
  const response = await base44Client.get(`api/apps`, {
    searchParams: {
      "sort": "-updated_date",
      "fields": "id,name,user_description,is_managed_source_code"
    }
  });

  const result = ProjectsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
