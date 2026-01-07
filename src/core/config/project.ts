import { join, dirname } from "node:path";
import { globby } from "globby";
import type { ProjectWithPaths } from "../schemas/project.js";
import { ProjectConfigSchema } from "../schemas/project.js";
import type { Entity } from "../schemas/entity.js";
import type { FunctionConfig } from "../schemas/function.js";
import { getProjectConfigPatterns, PROJECT_SUBDIR } from "../consts.js";
import { readJsonFile } from "../utils/fs.js";
import { readAllEntities } from "./entities.js";
import { readAllFunctions } from "./functions.js";

export interface ProjectRoot {
  root: string;
  configPath: string;
}

export interface ProjectData {
  project: ProjectWithPaths;
  entities: Entity[];
  functions: FunctionConfig[];
}

// Finds config file in a directory using globby, respecting priority order.
async function findConfigInDir(dir: string): Promise<string | null> {
  const files = await globby(getProjectConfigPatterns(), {
    cwd: dir,
    absolute: true,
  });
  return files[0] ?? null;
}

// Walks up the directory tree to locate a Base44 project config file.
export async function findProjectRoot(
  startPath?: string
): Promise<ProjectRoot | null> {
  let current = startPath || process.cwd();

  while (current !== dirname(current)) {
    const configPath = await findConfigInDir(current);
    if (configPath) {
      return { root: current, configPath };
    }
    current = dirname(current);
  }

  return null;
}

export async function readProjectConfig(
  projectRoot?: string
): Promise<ProjectData> {
  let found: ProjectRoot | null;

  if (projectRoot) {
    const configPath = await findConfigInDir(projectRoot);
    found = configPath ? { root: projectRoot, configPath } : null;
  } else {
    found = await findProjectRoot();
  }

  if (!found) {
    throw new Error(
      `Project root not found. Please ensure config.jsonc or config.json exists in the project directory or ${PROJECT_SUBDIR}/ subdirectory.`
    );
  }

  const { root, configPath } = found;

  const parsed = await readJsonFile(configPath);
  const result = ProjectConfigSchema.safeParse(parsed);

  if (!result.success) {
    const errors = result.error.issues.map((e) => e.message).join(", ");
    throw new Error(`Invalid project configuration: ${errors}`);
  }

  const project = result.data;
  const configDir = dirname(configPath);
  const entitiesPath = join(configDir, project.entitySrc);
  const functionsPath = join(configDir, project.functionSrc);

  const [entities, functions] = await Promise.all([
    readAllEntities(entitiesPath),
    readAllFunctions(functionsPath),
  ]);

  return {
    project: { ...project, root, configPath },
    entities,
    functions,
  };
}
