import { join, dirname } from "path";
import { ProjectConfigSchema, ProjectWithPaths } from "../schemas/project.js";
import { type Entity } from "../schemas/entity.js";
import { type FunctionConfig } from "../schemas/function.js";
import { PROJECT_CONFIG_FILE, PROJECT_SUBDIR } from "./constants.js";
import { readJsonFile, fileExists } from "../utils/fs.js";
import { readAllEntities } from "./entities.js";
import { readAllFunctions } from "./functions.js";

export interface ProjectRoot {
  root: string;
  configPath: string;
}

// Finds the project root by locating the config file in the .base44 folder or project directory.
export function findProjectRoot(startPath?: string): ProjectRoot | null {
  const start = startPath || process.cwd();
  let current = start;

  while (current !== dirname(current)) {
    // Check for config.jsonc in .base44 subdirectory first
    const subdirConfigPath = join(current, PROJECT_SUBDIR, PROJECT_CONFIG_FILE);
    if (fileExists(subdirConfigPath)) {
      return { root: current, configPath: subdirConfigPath };
    }

    // Then check for config.jsonc in the current directory
    const configPath = join(current, PROJECT_CONFIG_FILE);
    if (fileExists(configPath)) {
      return { root: current, configPath };
    }

    current = dirname(current);
  }

  return null;
}

export interface ProjectData {
  project: ProjectWithPaths;
  entities: Entity[];
  functions: FunctionConfig[];
}

export async function readProjectConfig(
  projectRoot?: string
): Promise<ProjectData> {
  const found = projectRoot
    ? { root: projectRoot, configPath: join(projectRoot, PROJECT_CONFIG_FILE) }
    : findProjectRoot();

  if (!found) {
    throw new Error(
      `Project root not found. Please ensure ${PROJECT_CONFIG_FILE} exists in the project directory or .base44/ subdirectory.`
    );
  }

  const { root, configPath } = found;

  try {
    const parsed = await readJsonFile(configPath);
    const result = ProjectConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid project configuration: ${result.error.issues
          .map((e) => e.message)
          .join(", ")}`
      );
    }

    const project = result.data;
    const configDir = dirname(configPath);
    const entitiesPath = join(configDir, project.entitySrc);
    const functionsPath = join(configDir, project.functionSrc);

    const [entities, functions] = await Promise.all([
      fileExists(entitiesPath) ? readAllEntities(entitiesPath) : [],
      fileExists(functionsPath) ? readAllFunctions(functionsPath) : [],
    ]);

    return {
      project: { ...project, root, configPath },
      entities,
      functions,
    };
  } catch (error) {
    throw new Error(
      `Failed to read project configuration: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
