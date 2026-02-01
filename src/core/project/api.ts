import { base44Client } from "@/core/clients/index.js";
import { CreateProjectResponseSchema, ProjectsResponseSchema } from "@/core/project/schema.js";
import type { ProjectsResponse } from "@/core/project/schema.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

export async function createProject(projectName: string, description?: string) {
  let response;
  try {
    response = await base44Client.post("api/apps", {
      json: {
        name: projectName,
        user_description: description ?? `Backend for '${projectName}'`,
        is_managed_source_code: false,
        public_settings: "public_without_login",
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "creating project");
  }

  const result = CreateProjectResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return {
    projectId: result.data.id,
  };
}

export async function listProjects(): Promise<ProjectsResponse> {
  let response;
  try {
    response = await base44Client.get("api/apps", {
      searchParams: {
        sort: "-updated_date",
        fields: "id,name,user_description,is_managed_source_code",
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing projects");
  }

  const result = ProjectsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
