import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import unzipper from "unzipper";
import kebabCase from "lodash.kebabcase";
import { base44Client } from "@core/clients/index.js";
import { deleteFile, makeDirectory } from "@core/utils/fs.js";
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

  // Save zip to temp file first (unzipper.Extract has issues with some files)
  const zipPath = join(tmpdir(), `base44-${projectId}-${Date.now()}.zip`);
  await pipeline(nodeStream, createWriteStream(zipPath));

  // Extract manually for reliable extraction of all files
  const outputDir = join(process.cwd(), kebabCase(projectName));
  const directory = await unzipper.Open.file(zipPath);

  for (const file of directory.files) {
    if (file.type === 'Directory') continue;

    const filePath = join(outputDir, file.path);
    await makeDirectory(dirname(filePath));
    await pipeline(file.stream(), createWriteStream(filePath));
  }

  // Clean up temp zip file
  await deleteFile(zipPath);
};
