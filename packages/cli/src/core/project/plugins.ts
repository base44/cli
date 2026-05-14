import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ConfigInvalidError } from "@/core/errors.js";
import type { ProjectConfig } from "@/core/project/schema.js";
import type { Entity } from "@/core/resources/entity/index.js";
import type { BackendFunction } from "@/core/resources/function/index.js";

export function resolvePluginRoot(
  pluginSource: string,
  fromRoot: string,
): string {
  if (pluginSource.startsWith(".") || isAbsolute(pluginSource)) {
    return resolve(fromRoot, pluginSource);
  }

  const req = createRequire(join(fromRoot, "package.json"));
  return dirname(req.resolve(`${pluginSource}/package.json`));
}

export function requirePluginNamespace(
  project: ProjectConfig,
  pluginSource: string,
  configPath: string,
): string {
  if (!project.plugin?.namespace) {
    throw new ConfigInvalidError(
      `Plugin loaded from "${pluginSource}" must define plugin.namespace`,
      configPath,
    );
  }

  return project.plugin.namespace;
}

export function namespacePluginFunctions(
  functions: BackendFunction[],
  pluginNamespace: string,
): BackendFunction[] {
  return functions.map((fn) => ({
    ...fn,
    name: `${pluginNamespace}__${fn.name}`,
    source: {
      type: "plugin",
      namespace: pluginNamespace,
    },
  }));
}

export function markPluginEntities(
  entities: Entity[],
  pluginNamespace: string,
): Entity[] {
  return entities.map((entity) => ({
    ...entity,
    source: {
      type: "plugin",
      namespace: pluginNamespace,
    },
  }));
}
