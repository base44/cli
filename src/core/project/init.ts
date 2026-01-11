import { join } from "node:path";
import { globby } from "globby";
import { getProjectConfigPatterns, PROJECT_SUBDIR } from "../config.js";
import { writeFile } from "../utils/fs.js";
import { createProject } from "./api.js";
import { renderConfigTemplate, renderEnvTemplate } from "./templates/index.js";

export interface InitProjectOptions {
  name: string;
  description?: string;
  path: string;
}

export interface InitProjectResult {
  projectId: string;
  projectDir: string;
  configPath: string;
  envPath: string;
}

/**
 * Initialize a new Base44 project.
 * Creates the base44 directory, config.jsonc, and .env.local files.
 */
export async function initProject(
  options: InitProjectOptions
): Promise<InitProjectResult> {
  const { name, description, path: basePath } = options;

  const projectDir = join(basePath, PROJECT_SUBDIR);
  const configPath = join(projectDir, "config.jsonc");
  const envPath = join(projectDir, ".env.local");

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

  // Create config.jsonc from template
  const configContent = await renderConfigTemplate({ name, description });
  await writeFile(configPath, configContent);

  // Create .env.local from template
  const envContent = await renderEnvTemplate({ projectId });
  await writeFile(envPath, envContent);

  return {
    projectId,
    projectDir,
    configPath,
    envPath,
  };
}
