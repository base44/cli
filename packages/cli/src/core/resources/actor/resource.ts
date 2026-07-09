import { readAllActors } from "@/core/resources/actor/config.js";
import { deployActorsSequentially } from "@/core/resources/actor/deploy.js";
import type { Actor } from "@/core/resources/actor/schema.js";
import type { Resource } from "@/core/resources/types.js";

export const actorResource: Resource<Actor> = {
  readAll: readAllActors,
  push: (actors) => deployActorsSequentially(actors),
};
