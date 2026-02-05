import { globby } from "globby";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/internal/consts.js";
import { SchemaValidationError } from "@/core/internal/errors.js";
import type { Entity } from "@/core/internal/resources/entity/schema.js";
import { EntitySchema } from "@/core/internal/resources/entity/schema.js";
import { pathExists, readJsonFile } from "@/core/internal/utils/fs.js";

async function readEntityFile(entityPath: string): Promise<Entity> {
  const parsed = await readJsonFile(entityPath);
  const result = EntitySchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid entity file",
      result.error,
      entityPath
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
    files.map((filePath) => readEntityFile(filePath))
  );

  return entities;
}
