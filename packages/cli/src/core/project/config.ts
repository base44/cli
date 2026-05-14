import { dirname, join } from "node:path";
import { globby } from "globby";
import { PROJECT_CONFIG_PATTERNS, PROJECT_SUBDIR } from "@/core/consts.js";
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  SchemaValidationError,
} from "@/core/errors.js";
import {
  markPluginEntities,
  namespacePluginFunctions,
  requirePluginNamespace,
  resolvePluginRoot,
} from "@/core/project/plugins.js";
import {
  type PluginReference,
  type ProjectConfig,
  ProjectConfigSchema,
} from "@/core/project/schema.js";
import type { ProjectData, ProjectRoot } from "@/core/project/types.js";
import { agentResource } from "@/core/resources/agent/index.js";
import { authConfigResource } from "@/core/resources/auth-config/index.js";
import { connectorResource } from "@/core/resources/connector/index.js";
import type { Entity } from "@/core/resources/entity/index.js";
import { entityResource } from "@/core/resources/entity/index.js";
import { mergeProjectAndPluginEntities } from "@/core/resources/entity/merge.js";
import {
  type BackendFunction,
  functionResource,
} from "@/core/resources/function/index.js";
import { readJsonFile } from "@/core/utils/fs.js";

type ProjectResources = Omit<ProjectData, "project">;

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
  startPath?: string,
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

class ProjectConfigReader {
  private readonly pluginSourceByNamespace = new Map<string, string>();

  async readProjectConfig(projectRoot?: string): Promise<ProjectData> {
    const { root, configPath } = await this.findConfigOrThrow(projectRoot);

    const project = await this.readConfigFile(configPath);
    this.assertPluginProjectDoesNotLoadPlugins(project, configPath);

    const localResources = await this.readProjectResources(configPath, project);
    const pluginResources = await this.readPlugins(project.plugins, configPath);

    const entities = mergeProjectAndPluginEntities(
      localResources.entities,
      pluginResources.entities,
      configPath,
    );

    const functions = [
      ...localResources.functions,
      ...pluginResources.functions,
    ];
    this.validateFunctionNames(functions, configPath);

    return {
      project: { ...project, root, configPath },
      entities,
      functions,
      agents: localResources.agents,
      connectors: localResources.connectors,
      authConfig: localResources.authConfig,
    };
  }

  private async findConfigOrThrow(projectRoot?: string): Promise<ProjectRoot> {
    let found: ProjectRoot | null;

    if (projectRoot) {
      const configPath = await findConfigInDir(projectRoot);
      found = configPath ? { root: projectRoot, configPath } : null;
    } else {
      found = await findProjectRoot();
    }

    if (!found) {
      throw new ConfigNotFoundError(
        `Project root not found. Please ensure config.jsonc or config.json exists in the project directory or ${PROJECT_SUBDIR}/ subdirectory.`,
      );
    }

    return found;
  }

  private async readConfigFile(configPath: string): Promise<ProjectConfig> {
    const parsed = await readJsonFile(configPath);
    const result = ProjectConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw new SchemaValidationError(
        "Invalid project configuration",
        result.error,
        configPath,
      );
    }

    return result.data;
  }

  private async readProjectResources(
    configPath: string,
    project: ProjectConfig,
  ): Promise<ProjectResources> {
    const configDir = dirname(configPath);
    const [entities, functions, agents, connectors, authConfig] =
      await Promise.all([
        entityResource.readAll(join(configDir, project.entitiesDir)),
        functionResource.readAll(join(configDir, project.functionsDir)),
        agentResource.readAll(join(configDir, project.agentsDir)),
        connectorResource.readAll(join(configDir, project.connectorsDir)),
        authConfigResource.readAll(join(configDir, project.authDir)),
      ]);

    return { entities, functions, agents, connectors, authConfig };
  }

  private assertPluginProjectDoesNotLoadPlugins(
    project: ProjectConfig,
    configPath: string,
  ): void {
    if (project.plugin && project.plugins.length > 0) {
      throw new ConfigInvalidError(
        "Plugin projects cannot define plugins in this version.",
        configPath,
      );
    }
  }

  private registerPluginNamespace(
    namespace: string,
    source: string,
    configPath: string,
  ): void {
    const existingSource = this.pluginSourceByNamespace.get(namespace);
    if (existingSource) {
      throw new ConfigInvalidError(
        `Duplicate plugin namespace "${namespace}" in project configuration: "${existingSource}" and "${source}".`,
        configPath,
        {
          hints: [
            {
              message: "Remove the plugin or change plugin namespace",
            },
          ],
        },
      );
    }

    this.pluginSourceByNamespace.set(namespace, source);
  }

  private async readPluginConfig(
    plugin: PluginReference,
    hostConfigPath: string,
  ) {
    const pluginRoot = resolvePluginRoot(
      plugin.source,
      dirname(hostConfigPath),
    );
    const { configPath } = await this.findConfigOrThrow(pluginRoot);

    const project = await this.readConfigFile(configPath);
    const namespace = requirePluginNamespace(
      project,
      plugin.source,
      configPath,
    );

    this.assertPluginProjectDoesNotLoadPlugins(project, configPath);

    return { configPath, namespace, project, source: plugin.source };
  }

  private async readPluginResources(
    project: ProjectConfig,
    configPath: string,
    namespace: string,
  ): Promise<ProjectResources> {
    const resources = await this.readProjectResources(configPath, project);

    return {
      entities: markPluginEntities(resources.entities, namespace),
      functions: namespacePluginFunctions(resources.functions, namespace),
      agents: [],
      connectors: [],
      authConfig: [],
    };
  }

  private async readPlugins(
    plugins: PluginReference[],
    configPath: string,
  ): Promise<ProjectResources> {
    const entities: Entity[] = [];
    const functions: BackendFunction[] = [];

    const pluginSourceByEntityName = new Map<string, string>();

    for (const plugin of plugins) {
      const {
        configPath: pluginConfigPath,
        namespace,
        project,
        source,
      } = await this.readPluginConfig(plugin, configPath);
      this.registerPluginNamespace(namespace, source, pluginConfigPath);

      const pluginData = await this.readPluginResources(
        project,
        pluginConfigPath,
        namespace,
      );

      for (const entity of pluginData.entities) {
        const existingSource = pluginSourceByEntityName.get(entity.name);
        if (existingSource) {
          throw new ConfigInvalidError(
            `Entity "${entity.name}" is defined by more than one plugin: "${existingSource}" and "${source}".`,
            pluginConfigPath,
            {
              hints: [
                {
                  message:
                    "Plugin entity names are not namespaced. Remove one plugin or rename one of the entities.",
                },
              ],
            },
          );
        }
        pluginSourceByEntityName.set(entity.name, source);
      }

      entities.push(...pluginData.entities);
      functions.push(...pluginData.functions);
    }

    return {
      entities,
      functions,
      agents: [],
      connectors: [],
      authConfig: [],
    };
  }

  private validateFunctionNames(
    functions: BackendFunction[],
    configPath: string,
  ): void {
    const functionsByName = new Map<string, BackendFunction>();

    for (const fn of functions) {
      const existingFunction = functionsByName.get(fn.name);
      if (existingFunction) {
        throw new ConfigInvalidError(
          `Duplicate function name "${fn.name}" after loading project plugins.`,
          configPath,
          {
            hints: [
              {
                message:
                  "Rename the project function or change the plugin namespace/function name so every deploy name is unique.",
              },
            ],
          },
        );
      }
      functionsByName.set(fn.name, fn);
    }
  }
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
  projectRoot?: string,
): Promise<ProjectData> {
  const reader = new ProjectConfigReader();
  return await reader.readProjectConfig(projectRoot);
}
