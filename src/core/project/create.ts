import { globby } from "globby";
import { getProjectConfigPatterns } from "../consts.js";
import { createProject, downloadProject } from "./api.js";
import { renderTemplate } from "./template.js";
import type { Template } from "./schema.js";
import kebabCase from "lodash.kebabcase";
import { pushEntities, pullEntities } from "@core/resources/index.js";
import { readProjectConfig } from "./config.js";

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
    projectId,
    projectDir: basePath,
  };
}

export async function createProjectFileForExistingProject(
  options: { projectId: string, projectName: string, path: string; }
): Promise<CreateProjectResult> {
  const { projectId, projectName, path: basePath } = options;

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
  await downloadProject(projectId, projectName);
  process.env.BASE44_CLIENT_ID = projectId;

  // Render the template to the destination path
  const newProject = await createProject(`${projectName} Copy`);
  
  await renderTemplate({
    "id": "backend-only",
    "name": "Init a basic project",
    "description": "Minimal Base44 backend setup for creating entities",
    "path": "backend-only"
  }, kebabCase(projectName), {
    name: `${projectName} Copy`,
    description: `Copy of ${projectName}`,
    projectId: newProject.projectId,
  });
  
  await pullEntities(kebabCase(projectName));
  
  process.env.BASE44_CLIENT_ID = newProject.projectId;
  const { entities } = await readProjectConfig(kebabCase(projectName));

  await pushEntities(entities);

  return {
    projectId,
    projectDir: basePath,
  };
}
