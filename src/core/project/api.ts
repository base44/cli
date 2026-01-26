import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import unzipper from "unzipper";
import kebabCase from "lodash.kebabcase";
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
  const response = await base44Client.get(`api/apps`, {
    searchParams: {
      "sort": "-updated_date",
      "fields": "id,name,user_description,is_managed_source_code"
    }
  });

  const projects = ProjectsResponseSchema.parse(await response.json());

  return projects;
}

export async function downloadProject(projectId: string, projectName: string) {
  const response = await base44Client.get(`api/apps/${projectId}/coding/export-to-zip`);
  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);

  await pipeline(
    nodeStream,
    unzipper.Extract({ path: join(process.cwd(), kebabCase(projectName)) })
  );
};
