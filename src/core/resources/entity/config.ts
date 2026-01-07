import { globby } from "globby";
import { readJsonFile, pathExists } from "../../utils/fs.js";
import { EntitySchema } from "./schema.js";
import type { Entity } from "./schema.js";

async function readEntityFile(entityPath: string): Promise<Entity> {
  const parsed = await readJsonFile(entityPath);
  const result = EntitySchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid entity configuration in ${entityPath}: ${result.error.issues
        .map((e) => e.message)
        .join(", ")}`
    );
  }

  return result.data;
}

export async function readAllEntities(entitiesDir: string): Promise<Entity[]> {
  if (!(await pathExists(entitiesDir))) {
    return [];
  }

  const files = await globby("*.{json,jsonc}", {
    cwd: entitiesDir,
    absolute: true,
  });

  const entities = await Promise.all(
    files.map((filePath) => readEntityFile(filePath))
  );

  return entities;
}
