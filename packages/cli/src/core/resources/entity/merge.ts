import { ConfigInvalidError } from "@/core/errors.js";
import type { Entity } from "@/core/resources/entity/schema.js";

/**
 * Applies a project entity extension to a plugin-owned entity.
 * The project may add new properties and mark those new properties as required.
 * It cannot override plugin properties or plugin-owned entity metadata.
 */
function mergePluginEntity(
  pluginEntity: Entity,
  projectEntity: Entity,
  configPath: string,
): Entity {
  // TODO: Define how project extensions can safely add top-level RLS rules,
  // especially rules that reference project-added fields, without weakening
  // plugin-owned entity access controls.
  const projectEntityFields = new Set(Object.keys(projectEntity));
  const unsupportedFields = ["title", "description", "rls"].filter((field) =>
    projectEntityFields.has(field),
  );

  if (unsupportedFields.length > 0) {
    throw new ConfigInvalidError(
      `Project entity "${projectEntity.name}" extends a plugin entity and cannot override fields: ${unsupportedFields.join(", ")}.`,
      configPath,
    );
  }

  const projectProperties = projectEntity.properties ?? {};
  const addedPropertyNames = new Set(Object.keys(projectProperties));

  for (const propertyName of addedPropertyNames) {
    if (propertyName in pluginEntity.properties) {
      throw new ConfigInvalidError(
        `Cannot override plugin-defined property "${propertyName}"`,
        configPath,
      );
    }
  }

  for (const requiredProperty of projectEntity.required ?? []) {
    if (!addedPropertyNames.has(requiredProperty)) {
      throw new ConfigInvalidError(
        `Project entity "${projectEntity.name}" can only mark project-added properties as required; "${requiredProperty}" is not declared in the project extension.`,
        configPath,
      );
    }
  }

  const required =
    pluginEntity.required || projectEntity.required
      ? [
          ...new Set([
            ...(pluginEntity.required ?? []),
            ...(projectEntity.required ?? []),
          ]),
        ]
      : undefined;

  return {
    ...pluginEntity,
    properties: {
      ...pluginEntity.properties,
      ...projectProperties,
    },
    ...(required ? { required } : {}),
  };
}

/**
 * Merges plugin entities with project entities of the same name.
 * A same-name project entity is treated as an extension of the plugin entity:
 * it may add fields, but cannot override fields owned by the plugin.
 */
export function mergeProjectAndPluginEntities(
  projectEntities: Entity[],
  pluginEntities: Entity[],
  configPath: string,
): Entity[] {
  const projectEntitiesByName = new Map(
    projectEntities.map((entity) => [entity.name, entity]),
  );
  const pluginEntityNames = new Set(
    pluginEntities.map((entity) => entity.name),
  );

  const resolvedPluginEntities = pluginEntities.map((pluginEntity) => {
    const projectEntity = projectEntitiesByName.get(pluginEntity.name);

    if (!projectEntity) {
      return pluginEntity;
    }

    return mergePluginEntity(pluginEntity, projectEntity, configPath);
  });

  const projectOnlyEntities = projectEntities.filter(
    (entity) => !pluginEntityNames.has(entity.name),
  );

  return [...resolvedPluginEntities, ...projectOnlyEntities];
}
