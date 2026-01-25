import { base44Client } from "@core/clients/index.js";
import { CreateProjectResponseSchema, ProjectsResponseSchema } from "./schema.js";
import type { ProjectsResponse } from "./schema.js";

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

export async function listProjects(): Promise<ProjectsResponse> {
  const query = 'sort=-updated_date&fields=id,name,user_description,is_managed_source_code';
  const response = await base44Client.get(`api/apps?${query}`);
  const projects = ProjectsResponseSchema.parse(await response.json());

  return projects;
}
