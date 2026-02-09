import { readAllEntities } from "@/core/resources/entity/config.js";
import { pushEntities } from "@/core/resources/entity/deploy.js";
import type { Entity } from "@/core/resources/entity/schema.js";
import type { Resource } from "@/core/resources/types.js";

export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
  push: pushEntities,
};
