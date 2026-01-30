import { globby } from "globby";
import { readJsonFile, pathExists } from "@/core/utils/fs.js";
import { EntitySchema } from "@/core/resources/entity/schema.js";
import type { Entity } from "@/core/resources/entity/schema.js";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { SchemaValidationError } from "@/core/errors.js";

async function readEntityFile(entityPath: string): Promise<Entity> {
  const parsed = await readJsonFile(entityPath);
  const result = EntitySchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(`Invalid entity file at ${entityPath}`, result.error);
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
    files.map((filePath) => readEntityFile(filePath))
  );

  return entities;
}
