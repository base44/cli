/**
 * Entities namespace for the SDK.
 * Provides entity read and push operations.
 */

import { dirname, join } from "node:path";
import { SchemaValidationError } from "@/core/internal/errors.js";
import { findProjectRoot } from "@/core/internal/project/config.js";
import { ProjectConfigSchema } from "@/core/internal/project/schema.js";
import { syncEntities } from "@/core/internal/resources/entity/api.js";
import { readAllEntities } from "@/core/internal/resources/entity/config.js";
import type {
  Entity,
  SyncEntitiesResponse,
} from "@/core/internal/resources/entity/schema.js";
import { readJsonFile } from "@/core/internal/utils/fs.js";
import type { AppClient, SDKConfig } from "../types.js";

export class EntitiesNamespace {
  constructor(
    private config: SDKConfig,
    private client: AppClient
  ) {}

  /**
   * Read all entities from the project's entities directory.
   */
  async readAll(): Promise<Entity[]> {
    const entitiesDir = await this.getEntitiesDir();
    return readAllEntities(entitiesDir);
  }

  /**
   * Push entities to Base44.
   * Syncs local entities with remote, creating/updating/deleting as needed.
   */
  async push(entities: Entity[]): Promise<SyncEntitiesResponse> {
    if (entities.length === 0) {
      return { created: [], updated: [], deleted: [] };
    }
    return syncEntities(entities, this.client);
  }

  private async getEntitiesDir(): Promise<string> {
    const found = await findProjectRoot(this.config.projectRoot);
    if (!found) {
      throw new Error(`Project not found at ${this.config.projectRoot}`);
    }

    const parsed = await readJsonFile(found.configPath);
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new SchemaValidationError(
        "Invalid project configuration",
        result.error
      );
    }

    return join(dirname(found.configPath), result.data.entitiesDir);
  }
}
