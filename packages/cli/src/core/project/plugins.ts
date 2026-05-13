import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { ConfigInvalidError } from "@/core/errors.js";
import type { ProjectConfig } from "@/core/project/schema.js";
import type { Entity } from "@/core/resources/entity/index.js";
import type { BackendFunction } from "@/core/resources/function/index.js";

export function resolvePluginRoot(
  pluginSource: string,
  fromRoot: string,
): string {
  if (pluginSource.startsWith(".")) {
    return resolve(fromRoot, pluginSource);
  }

  const req = createRequire(join(fromRoot, "package.json"));
  return dirname(req.resolve(`${pluginSource}/package.json`));
}

export function requirePluginId(
  project: ProjectConfig,
  pluginSource: string,
  configPath: string,
): string {
  if (!project.plugin?.id) {
    throw new ConfigInvalidError(
      `Plugin loaded from "${pluginSource}" must define plugin.id`,
      configPath,
    );
  }

  return project.plugin.id;
}

export function namespacePluginFunctions(
  functions: BackendFunction[],
  pluginId: string,
): BackendFunction[] {
  return functions.map((fn) => ({
    ...fn,
    name: `${pluginId}__${fn.name}`,
    source: {
      type: "plugin",
      id: pluginId,
    },
  }));
}

export function markPluginEntities(
  entities: Entity[],
  pluginId: string,
): Entity[] {
  return entities.map((entity) => ({
    ...entity,
    source: {
      type: "plugin",
      id: pluginId,
    },
  }));
}
