import type { Resource } from "../types.js";
import type { Entity } from "./schema.js";
import { readAllEntities } from "./config.js";
import { pushEntities } from "./deploy.js";

export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
  push: pushEntities,
};
