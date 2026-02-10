import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { KyResponse } from "ky";
import { extract } from "tar";
import { base44Client } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type { ProjectsResponse } from "@/core/project/schema.js";
import {
  CreateProjectResponseSchema,
  ProjectsResponseSchema,
} from "@/core/project/schema.js";
import { makeDirectory } from "@/core/utils/fs.js";

export async function createProject(projectName: string, description?: string) {
  let response: KyResponse;
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
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return {
    projectId: result.data.id,
  };
}

export async function listProjects(): Promise<ProjectsResponse> {
  let response: KyResponse;
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
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}

export async function downloadProject(projectId: string, projectPath: string) {
  let response: KyResponse;
  try {
    response = await base44Client.get(`api/apps/${projectId}/eject`, {
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "downloading project");
  }

  const nodeStream = Readable.fromWeb(
    response.body as import("node:stream/web").ReadableStream
  );

  await makeDirectory(projectPath);
  await pipeline(nodeStream, extract({ cwd: projectPath }));
}
