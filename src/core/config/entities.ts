import { globby } from "globby";
import { EntitySchema  } from "../schemas/entity.js";
import type {Entity} from "../schemas/entity.js";
import { readJsonFile, pathExists } from "../utils/fs.js";

async function readEntityFile(entityPath: string): Promise<Entity> {
  if (!(await pathExists(entityPath))) {
    throw new Error(`Entity file not found: ${entityPath}`);
  }

  try {
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
  } catch (error) {
    throw new Error(
      `Failed to read entity file ${entityPath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function readAllEntities(entitiesDir: string): Promise<Entity[]> {
  if (!(await pathExists(entitiesDir))) {
    throw new Error(`Entities directory not found: ${entitiesDir}`);
  }

  const files = await globby("*.{json,jsonc}", {
    cwd: entitiesDir,
    absolute: true,
  });

  const entities: Entity[] = [];

  for (const filePath of files) {
    const entity = await readEntityFile(filePath);
    entities.push(entity);
  }

  return entities;
}
