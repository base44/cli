import { globby } from "globby";
import { PROJECT_CONFIG_PATTERNS } from "@/core/consts.js";
import { createProject } from "@/core/project/api.js";
import { renderTemplate } from "@/core/project/template.js";
import type { Template } from "@/core/project/schema.js";

export interface CreateProjectOptions {
  name: string;
  description?: string;
  path: string;
  template: Template;
}

export interface CreateProjectResult {
  projectId: string;
  projectDir: string;
}

export async function createProjectFiles(
  options: CreateProjectOptions
): Promise<CreateProjectResult> {
  const { name, description, path: basePath, template } = options;

  // Check if project already exists
  const existingConfigs = await globby(PROJECT_CONFIG_PATTERNS, {
    cwd: basePath,
    absolute: true,
  });

  if (existingConfigs.length > 0) {
    throw new Error(
      `A Base44 project already exists at ${existingConfigs[0]}. Please choose a different location.`
    );
  }

  // Create the project via API to get the app ID
  const { projectId } = await createProject(name, description);

  // Render the template to the destination path
  await renderTemplate(template, basePath, {
    name,
    description,
    projectId,
  });

  return {
    projectId,
    projectDir: basePath,
  };
}
