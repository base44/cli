import { join, dirname } from "node:path";
import { z } from "zod";
import { globby } from "globby";
import { getProjectConfigPatterns, PROJECT_SUBDIR } from "../consts.js";
import { readJsonFile } from "../utils/fs.js";
import { entityResource } from "../resources/entity/index.js";
import type { Entity } from "../resources/entity/index.js";
import { functionResource } from "../resources/function/index.js";
import type { FunctionConfig } from "../resources/function/index.js";

export const ProjectConfigSchema = z.looseObject({
  name: z.string().min(1, "Project name cannot be empty"),
  entitySrc: z.string().default("./entities"),
  functionSrc: z.string().default("./functions"),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface ProjectWithPaths extends ProjectConfig {
  root: string;
  configPath: string;
}

export interface ProjectRoot {
  root: string;
  configPath: string;
}

export interface ProjectData {
  project: ProjectWithPaths;
  entities: Entity[];
  functions: FunctionConfig[];
}

async function findConfigInDir(dir: string): Promise<string | null> {
  const files = await globby(getProjectConfigPatterns(), {
    cwd: dir,
    absolute: true,
  });
  return files[0] ?? null;
}

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

  const [entities, functions] = await Promise.all([
    entityResource.readAll(join(configDir, project.entitySrc)),
    functionResource.readAll(join(configDir, project.functionSrc)),
  ]);

  return {
    project: { ...project, root, configPath },
    entities,
    functions,
  };
}
