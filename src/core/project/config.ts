import { join, dirname } from "node:path";
import { globby } from "globby";
import { PROJECT_CONFIG_PATTERNS, PROJECT_SUBDIR } from "@/core/consts.js";
import { readJsonFile } from "@/core/utils/fs.js";
import { entityResource } from "@/core/resources/entity/index.js";
import { functionResource } from "@/core/resources/function/index.js";
import { agentResource } from "@/core/resources/agent/index.js";
import type { ProjectData, ProjectRoot } from "@/core/project/types.js";
import { ProjectConfigSchema } from "@/core/project/schema.js";
import { ConfigNotFoundError, SchemaValidationError } from "@/core/errors.js";

async function findConfigInDir(dir: string): Promise<string | null> {
  const files = await globby(PROJECT_CONFIG_PATTERNS, {
    cwd: dir,
    absolute: true,
  });
  return files[0] ?? null;
}

/**
 * Searches for a Base44 project root by looking for config files.
 * Walks up the directory tree from the starting path until it finds a config file.
 *
 * @param startPath - Directory to start searching from. Defaults to cwd.
 * @returns Project root info if found, null otherwise.
 *
 * @example
 * const found = await findProjectRoot();
 * if (found) {
 *   console.log(`Project found at: ${found.root}`);
 * }
 */
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

/**
 * Reads and validates a Base44 project configuration from the filesystem.
 * Also loads all entities and functions defined in the project.
 *
 * @param projectRoot - Optional path to start searching from. Defaults to cwd.
 * @returns Project configuration including entities and functions.
 * @throws {Error} If no config file is found or if the config is invalid.
 *
 * @example
 * const { project, entities, functions } = await readProjectConfig();
 */
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
    throw new ConfigNotFoundError(
      `Project root not found. Please ensure config.jsonc or config.json exists in the project directory or ${PROJECT_SUBDIR}/ subdirectory.`
    );
  }

  const { root, configPath } = found;

  const parsed = await readJsonFile(configPath);
  const result = ProjectConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError("Invalid project configuration", result.error);
  }

  const project = result.data;
  const configDir = dirname(configPath);

  const [entities, functions, agents] = await Promise.all([
    entityResource.readAll(join(configDir, project.entitiesDir)),
    functionResource.readAll(join(configDir, project.functionsDir)),
    agentResource.readAll(join(configDir, project.agentsDir)),
  ]);

  return {
    project: { ...project, root, configPath },
    entities,
    functions,
    agents,
  };
}
