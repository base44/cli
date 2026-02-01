/**
 * Entities namespace for the SDK.
 * Provides entity read and push operations.
 */

import { join, dirname } from "node:path";
import type { SDKConfig, AppClient } from "@/core/sdk/types.js";
import { readAllEntities } from "@/core/resources/entity/config.js";
import { syncEntities } from "@/core/resources/entity/api.js";
import type { Entity, SyncEntitiesResponse } from "@/core/resources/entity/schema.js";
import { findProjectRoot } from "@/core/project/config.js";
import { readJsonFile } from "@/core/utils/fs.js";
import { ProjectConfigSchema } from "@/core/project/schema.js";
import { SchemaValidationError } from "@/core/errors.js";

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
      throw new SchemaValidationError("Invalid project configuration", result.error);
    }

    return join(dirname(found.configPath), result.data.entitiesDir);
  }
}
