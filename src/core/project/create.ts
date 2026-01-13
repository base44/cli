import { globby } from "globby";
import { getProjectConfigPatterns } from "../consts.js";
import { createProject } from "./api.js";
import { renderTemplate } from "./template.js";
import type { Template } from "./schema.js";

export interface CreateProjectOptions {
  name: string;
  description?: string;
  path: string;
  template: Template;
}

export interface CreateProjectResult {
  projectDir: string;
}

export async function createProjectFiles(
  options: CreateProjectOptions
): Promise<CreateProjectResult> {
  const { name, description, path: basePath, template } = options;

  // Check if project already exists
  const existingConfigs = await globby(getProjectConfigPatterns(), {
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
    projectDir: basePath,
  };
}
