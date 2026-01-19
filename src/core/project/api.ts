import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import unzipper from "unzipper";
import kebabCase from "lodash.kebabcase";
import { base44Client } from "@core/clients/index.js";
import { CreateProjectResponseSchema } from "./schema.js";

export async function createProject(projectName: string, description?: string) {
  const response = await base44Client.post("api/apps", {
    json: {
      name: projectName,
      user_description: description ?? `Backend for '${projectName}'`,
      app_type: "baas",
      public_settings: "public_without_login"
    },
  });

  const result = CreateProjectResponseSchema.parse(await response.json());

  return {
    projectId: result.id,
  };
};

export async function getProject(projectId: string) {
  const response = await base44Client.get(`api/apps/${projectId}`);
  return await response.json() as Project;
};

export type Project = {
  id: string;
  name: string;
  user_description: string;
};

export async function listProjects() {
  const response = await base44Client.get(`api/apps?sort=-updated_date&limit=20&fields=id,name,user_description,status,updated_date`);
  const projects = await response.json() as Project[];

  return projects;
};

export async function downloadProject(projectId: string, projectName: string) {
  const response = await base44Client.get(`api/apps/${projectId}/coding/export-to-zip`);
  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);

  await pipeline(
    nodeStream,
    unzipper.Extract({ path: join(process.cwd(), kebabCase(projectName)) })
  );
};
