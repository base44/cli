import { join, dirname } from 'path';
import { ProjectConfigSchema, type ProjectConfig } from '../schemas/project.js';
import { type Entity } from '../schemas/entity.js';
import { type FunctionConfig } from '../schemas/function.js';
import { PROJECT_CONFIG_FILE } from './constants.js';
import { readJsonFile, fileExists } from '../utils/fs.js';
import { readAllEntities } from './entities.js';
import { readAllFunctions } from './functions.js';

export function findProjectRoot(startPath?: string): string | null {
  const start = startPath || process.cwd();
  let current = start;

  while (current !== dirname(current)) {
    const configPath = join(current, PROJECT_CONFIG_FILE);
    if (fileExists(configPath)) {
      return current;
    }
    current = dirname(current);
  }

  return null;
}

export interface ProjectData {
  project: ProjectConfig;
  entities: Entity[];
  functions: FunctionConfig[];
}

export async function readProjectConfig(
  projectRoot?: string
): Promise<ProjectData> {
  const root = projectRoot || findProjectRoot();

  if (!root) {
    throw new Error(
      `Project root not found. Please ensure ${PROJECT_CONFIG_FILE} exists in the project directory.`
    );
  }

  const configPath = join(root, PROJECT_CONFIG_FILE);

  try {
    const parsed = await readJsonFile(configPath);
    const result = ProjectConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid project configuration: ${result.error.issues
          .map((e) => e.message)
          .join(', ')}`
      );
    }

    const project = result.data;
    const entitiesPath = join(root, project.entitySrc);
    const functionsPath = join(root, project.functionSrc);

    const [entities, functions] = await Promise.allSettled([
      fileExists(entitiesPath)
        ? readAllEntities(entitiesPath)
        : Promise.resolve([]),
      fileExists(functionsPath)
        ? readAllFunctions(functionsPath)
        : Promise.resolve([]),
    ]);

    const entitiesData =
      entities.status === 'fulfilled' ? entities.value : [];
    const functionsData =
      functions.status === 'fulfilled' ? functions.value : [];

    if (entities.status === 'rejected' && fileExists(entitiesPath)) {
      throw new Error(
        `Failed to read entities: ${
          entities.reason instanceof Error
            ? entities.reason.message
            : 'Unknown error'
        }`
      );
    }

    if (functions.status === 'rejected' && fileExists(functionsPath)) {
      throw new Error(
        `Failed to read functions: ${
          functions.reason instanceof Error
            ? functions.reason.message
            : 'Unknown error'
        }`
      );
    }

    return {
      project,
      entities: entitiesData,
      functions: functionsData,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid project')) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('File not found')) {
      throw new Error(
        `Project configuration file not found: ${configPath}. Please ensure ${PROJECT_CONFIG_FILE} exists.`
      );
    }
    throw new Error(
      `Failed to read project configuration: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

