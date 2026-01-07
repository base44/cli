import type { Resource } from "@core/config/resource.js";
import type { Entity } from "./schema.js";
import { readAllEntities } from "./config.js";

export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
};
