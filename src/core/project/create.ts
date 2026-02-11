import { globby } from "globby";
import { PROJECT_CONFIG_PATTERNS } from "@/core/consts.js";
import { ConfigExistsError } from "@/core/errors.js";
import { createProject, downloadProject } from "@/core/project/api.js";
import type { Template } from "@/core/project/schema.js";
import { renderTemplate } from "@/core/project/template.js";

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

/**
 * Asserts that no Base44 project config exists at the given path.
 * Throws ConfigExistsError if a project is already configured there.
 */
async function assertProjectNotExists(dirPath: string): Promise<void> {
  const existingConfigs = await globby(PROJECT_CONFIG_PATTERNS, {
    cwd: dirPath,
    absolute: true,
  });

  if (existingConfigs.length > 0) {
    throw new ConfigExistsError(
      `A Base44 project already exists at ${existingConfigs[0]}. Please choose a different location.`,
    );
  }
}

export async function createProjectFiles(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const { name, description, path: basePath, template } = options;

  await assertProjectNotExists(basePath);

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

export async function createProjectFilesForExistingProject(options: {
  projectId: string;
  projectPath: string;
}): Promise<CreateProjectResult> {
  const { projectId, projectPath } = options;

  await assertProjectNotExists(projectPath);

  // Download the project's ZIP and extract the files
  await downloadProject(projectId, projectPath);

  return {
    projectId,
    projectDir: projectPath,
  };
}
