import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { Parser } from "tar";
import { base44Client } from "@core/clients/index.js";
import { makeDirectory, writeFile } from "@core/utils/fs.js";
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

interface FunctionConfig {
  name: string;
  entry: string;
  files: Array<{ path: string; content: string }>;
}

export async function downloadProject(projectId: string, projectPath: string) {
  const response = await base44Client.get(`api/apps/${projectId}/eject`, { timeout: false });
  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);

  await makeDirectory(projectPath);

  // Patterns for special handling
  const functionConfigPattern = /^base44\/functions\/[^/]+\/config\.jsonc$/;
  const agentOrEntityPattern = /^base44\/(agents|entities)\/[^/]+\.jsonc$/;

  const parser = new Parser({
    onReadEntry: async (entry) => {
      const entryPath = entry.path;
      const fullPath = join(projectPath, entryPath);

      // Skip root-level functions/ directory (we generate from base44/functions/)
      if (entryPath.startsWith("functions/")) {
        entry.resume();
        return;
      }

      if (entry.type === "Directory") {
        await makeDirectory(fullPath);
        entry.resume();
        return;
      }

      // Read file content
      const chunks: Buffer[] = [];
      for await (const chunk of entry) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks).toString("utf-8");

      // Handle function config files
      if (functionConfigPattern.test(entryPath)) {
        const config: FunctionConfig = JSON.parse(content);
        const funcDir = dirname(fullPath);

        // Write function.jsonc with only name and entry
        const funcConfig = { name: config.name, entry: config.entry };
        await writeFile(
          join(funcDir, "function.jsonc"),
          JSON.stringify(funcConfig, null, 2)
        );

        // Write each file from the files array
        for (const file of config.files) {
          await writeFile(join(funcDir, file.path), file.content);
        }
      }
      // Handle agent and entity files - remove .jsonc suffix from name
      else if (agentOrEntityPattern.test(entryPath)) {
        const config = JSON.parse(content);
        if (config.name && config.name.endsWith(".json")) {
          config.name = config.name.replace(/\.json$/, "");
        }
        await makeDirectory(dirname(fullPath));
        await writeFile(fullPath, JSON.stringify(config, null, 2));
      }
      // Regular file - write as-is
      else {
        await makeDirectory(dirname(fullPath));
        await writeFile(fullPath, content);
      }
    },
  });

  await pipeline(nodeStream, parser);
}
