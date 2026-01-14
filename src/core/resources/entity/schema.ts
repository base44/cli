import { z } from "zod";

export const EntitySchema = z.looseObject({
  name: z.string().min(1, "Entity name cannot be empty"),
});

export type Entity = z.infer<typeof EntitySchema>;

export const SyncEntitiesResponseSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});

export type SyncEntitiesResponse = z.infer<typeof SyncEntitiesResponseSchema>;
