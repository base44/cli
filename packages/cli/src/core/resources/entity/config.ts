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

  const names = new Set<string>();
  for (const entity of entities) {
    if (names.has(entity.name)) {
      throw new ConfigInvalidError(
        `Duplicate entity name "${entity.name}" in ${entitiesDir}`,
        entitiesDir,
        {
          hints: [
            {
              message: `Remove duplicate entities with name "${entity.name}" - only one entity per name is allowed`,
            },
          ],
        },
      );
    }
    names.add(entity.name);
  }

  return entities;
}
