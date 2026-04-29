import { globby } from "globby";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { ConfigInvalidError, SchemaValidationError } from "@/core/errors.js";
import type { Entity } from "@/core/resources/entity/schema.js";
import { EntitySchema } from "@/core/resources/entity/schema.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";

async function readEntityFile(entityPath: string): Promise<Entity> {
  const parsed = await readJsonFile(entityPath);
  const result = EntitySchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid entity file",
      result.error,
      entityPath,
    );
  }

  return result.data;
}

export async function readAllEntities(entitiesDir: string): Promise<Entity[]> {
  if (!(await pathExists(entitiesDir))) {
    return [];
  }

  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: entitiesDir,
    absolute: true,
  });

  const entities = await Promise.all(
    files.map((filePath) => readEntityFile(filePath)),
  );

  return entities;
}

/**
 * Combines an app's entities with a plugin's entities, matched by name.
 * The app may extend a plugin entity with new properties, but redefining any
 * property the plugin already declares is rejected.
 */
export function mergeEntities(
  appEntities: Entity[],
  pluginEntities: Entity[],
): Entity[] {
  const appEntitiesByName = new Map(appEntities.map((entity) => [entity.name, entity]));

  let mergedEntities: Entity[] = [];

  pluginEntities.forEach(pluginEntity => {
    const appEntityToMerge = appEntitiesByName.get(pluginEntity.name);

    if (appEntityToMerge) {
      const appEntityProperties = Object.keys(appEntityToMerge.properties);
      const pluginEntityProperties = Object.keys(pluginEntity.properties);
      const collidingProperties = appEntityProperties.filter(prop => pluginEntityProperties.includes(prop));

      if (collidingProperties.length) {
        const collidingPropertiesNames = collidingProperties.map((name) => `"${name}"`).join(", ");

        throw new ConfigInvalidError(
          `Entity "${appEntityToMerge.name}" cannot override plugin-defined properties: ${collidingPropertiesNames}.
        Plugin properties are protected — remove or rename them in your local entity.`,
        );
      }

      mergedEntities.push({
        ...pluginEntity,
        properties: {
          ...pluginEntity.properties,
          ...appEntityToMerge.properties
        }
      })

      appEntitiesByName.delete(appEntityToMerge.name);
    } else {
      mergedEntities.push(pluginEntity);
    }
  })

  return [...mergedEntities, ...appEntitiesByName.values()];
}
