import { globby } from 'globby';
import { EntitySchema, type Entity } from '../schemas/entity.js';
import { readJsonFile, fileExists } from '../utils/fs.js';

export async function readEntityFile(entityPath: string): Promise<Entity> {
  if (!fileExists(entityPath)) {
    throw new Error(`Entity file not found: ${entityPath}`);
  }

  try {
    const parsed = await readJsonFile(entityPath);
    const result = EntitySchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid entity configuration in ${entityPath}: ${result.error.issues
          .map((e) => e.message)
          .join(', ')}`
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid entity')) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('File not found')) {
      throw error;
    }
    throw new Error(
      `Failed to read entity file ${entityPath}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export async function readAllEntities(entitiesDir: string): Promise<Entity[]> {
  if (!fileExists(entitiesDir)) {
    throw new Error(`Entities directory not found: ${entitiesDir}`);
  }

  try {
    const files = await globby('*.{json,jsonc}', { cwd: entitiesDir, absolute: true });

    const entities: Entity[] = [];
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const entity = await readEntityFile(filePath);
        entities.push(entity);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${filePath}: ${errorMessage}`);
      }
    }

    if (errors.length > 0 && entities.length === 0) {
      throw new Error(
        `Failed to read any entity files:\n${errors.join('\n')}`
      );
    }

    if (errors.length > 0) {
      console.warn(
        `Warning: Some entity files could not be read:\n${errors.join('\n')}`
      );
    }

    return entities;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to read')) {
      throw error;
    }
    throw new Error(
      `Failed to read entities directory ${entitiesDir}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

