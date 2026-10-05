import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { PROJECT_SUBDIR } from "@/core/consts.js";
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  SchemaValidationError,
} from "@/core/errors.js";
import {
  defaultProjectConfig,
  onlyDefaultableFieldsInvalid,
  salvageProjectConfig,
  warnConfigFallback,
} from "@/core/project/fallback.js";
import { findConfigInDir, findProjectRoot } from "@/core/project/find-root.js";
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
import type {
  ProjectData,
  ProjectRoot,
  ProjectWithPaths,
} from "@/core/project/types.js";
import { actorResource } from "@/core/resources/actor/index.js";
import { agentResource } from "@/core/resources/agent/index.js";
import { agentSkillResource } from "@/core/resources/agent-skill/index.js";
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

/**
 * - `strict`: any problem fails. A plugin's config is not this project's to default.
 * - `safe`: fields that describe the app or its site fall back to their defaults;
 *   a missing or unreadable file, or a field that decides which resources load,
 *   still fails, since a command that syncs them would push the wrong set.
 * - `lenient`: nothing about the file fails. Only for commands that read the
 *   site block alone.
 */
type ConfigReadMode = "strict" | "safe" | "lenient";

const PROJECT_ROOT_NOT_FOUND = `Project root not found. Please ensure config.jsonc or config.json exists in the project directory or ${PROJECT_SUBDIR}/ subdirectory.`;

class ProjectConfigReader {
  private readonly pluginSourceByNamespace = new Map<string, string>();

  async readProjectSettings(projectRoot?: string): Promise<ProjectWithPaths> {
    const { root, configPath } = await this.findConfigOrThrow(projectRoot);

    const project = await this.readConfigFile(configPath, "safe");
    this.assertPluginProjectDoesNotLoadPlugins(project, configPath);

    return { ...project, root, configPath };
  }

  async readProjectSettingsOrDefaults(
    projectRoot?: string,
  ): Promise<ProjectWithPaths> {
    const found = this.findConfig(projectRoot);
    if (!found) {
      return this.defaultSettingsOrThrow(projectRoot);
    }

    const project = await this.readConfigFile(found.configPath, "lenient");
    return { ...project, ...found };
  }

  async readProjectConfig(projectRoot?: string): Promise<ProjectData> {
    const project = await this.readProjectSettings(projectRoot);
    const { configPath } = project;

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
    const functionNames = new Set(functions.map((fn) => fn.name));
    for (const actor of localResources.actors) {
      if (functionNames.has(actor.name)) {
        throw new ConfigInvalidError(
          `'${actor.name}' exists as both a backend function and an actor`,
          configPath,
        );
      }
    }

    return {
      project,
      entities,
      functions,
      actors: localResources.actors,
      agents: localResources.agents,
      agentSkills: localResources.agentSkills,
      connectors: localResources.connectors,
      authConfig: localResources.authConfig,
    };
  }

  private async findConfigOrThrow(projectRoot?: string): Promise<ProjectRoot> {
    const found = this.findConfig(projectRoot);
    if (!found) {
      throw new ConfigNotFoundError(PROJECT_ROOT_NOT_FOUND);
    }
    return found;
  }

  private findConfig(projectRoot?: string): ProjectRoot | null {
    if (!projectRoot) {
      return findProjectRoot();
    }
    const configPath = findConfigInDir(projectRoot);
    return configPath ? { root: projectRoot, configPath } : null;
  }

  /** A folder with neither a config nor a package.json is not a project at all. */
  private defaultSettingsOrThrow(projectRoot?: string): ProjectWithPaths {
    const root = projectRoot ?? process.cwd();
    if (!existsSync(join(root, "package.json"))) {
      throw new ConfigNotFoundError(PROJECT_ROOT_NOT_FOUND);
    }

    warnConfigFallback(
      `No ${PROJECT_SUBDIR}/config.jsonc found in ${root}; using the default project config.`,
    );
    const configPath = join(root, PROJECT_SUBDIR, "config.jsonc");
    return { ...defaultProjectConfig(), root, configPath };
  }

  private async readConfigFile(
    configPath: string,
    mode: ConfigReadMode = "strict",
  ): Promise<ProjectConfig> {
    let parsed: unknown;
    try {
      parsed = await readJsonFile(configPath);
    } catch (error) {
      if (mode !== "lenient") {
        throw error;
      }
      warnConfigFallback(
        `${configPath} could not be read (${errorMessage(error)}); using the default project config.`,
      );
      return defaultProjectConfig();
    }

    const result = ProjectConfigSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    const defaultable =
      mode === "lenient" ||
      (mode === "safe" && onlyDefaultableFieldsInvalid(result.error));
    if (!defaultable) {
      throw new SchemaValidationError(
        "Invalid project configuration",
        result.error,
        configPath,
      );
    }

    warnConfigFallback(
      `Invalid project configuration in ${configPath}; using defaults for the invalid fields:\n${z.prettifyError(result.error)}`,
    );
    return salvageProjectConfig(parsed, result.error);
  }

  private async readProjectResources(
    configPath: string,
    project: ProjectConfig,
    includeActors = true,
  ): Promise<ProjectResources> {
    const configDir = dirname(configPath);
    const [
      entities,
      functions,
      actors,
      agents,
      agentSkills,
      connectors,
      authConfig,
    ] = await Promise.all([
      entityResource.readAll(join(configDir, project.entitiesDir)),
      functionResource.readAll(join(configDir, project.functionsDir)),
      includeActors
        ? actorResource.readAll(join(configDir, project.actorsDir))
        : Promise.resolve([]),
      agentResource.readAll(join(configDir, project.agentsDir)),
      agentSkillResource.readAll(join(configDir, project.agentSkillsDir)),
      connectorResource.readAll(join(configDir, project.connectorsDir)),
      authConfigResource.readAll(join(configDir, project.authDir)),
    ]);

    return {
      entities,
      functions,
      actors,
      agents,
      agentSkills,
      connectors,
      authConfig,
    };
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
    const resources = await this.readProjectResources(
      configPath,
      project,
      false,
    );

    return {
      entities: markPluginEntities(resources.entities, namespace),
      functions: namespacePluginFunctions(resources.functions, namespace),
      actors: [],
      agents: [],
      agentSkills: [],
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
      actors: [],
      agents: [],
      agentSkills: [],
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

/**
 * Reads and validates the project config file alone — none of the project's
 * resource files are read or validated.
 *
 * For a command that consumes no resources, an invalid resource file is unrelated
 * to the work and must not fail it.
 *
 * @param projectRoot - Optional path to start searching from. Defaults to cwd.
 * @returns The project config, with its root and config path.
 */
export async function readProjectSettings(
  projectRoot?: string,
): Promise<ProjectWithPaths> {
  const reader = new ProjectConfigReader();
  return await reader.readProjectSettings(projectRoot);
}

/**
 * Like {@link readProjectSettings}, but never fails on the config: a missing
 * one (in a folder with a package.json), an unreadable one or any invalid
 * field falls back to the template defaults, with a warning.
 *
 * Only for commands that read the site block and nothing else — installing or
 * serving the frontend. A command that loads or pushes resources must not run
 * on a guessed layout.
 */
export async function readProjectSettingsOrDefaults(
  projectRoot?: string,
): Promise<ProjectWithPaths> {
  const reader = new ProjectConfigReader();
  return await reader.readProjectSettingsOrDefaults(projectRoot);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
