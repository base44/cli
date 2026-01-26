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

export const GetEntitiesResponseSchema = z.object({
  schemas: z.array(z.object({
    entity_name: z.string(),
    entity_schema: z.any(),
  })),
}).transform((data) => ({
  schemas: data.schemas.map((schema) => ({
    entityName: schema.entity_name,
    entitySchema: schema.entity_schema,
  })),
}));

export type GetEntitiesResponse = z.infer<typeof GetEntitiesResponseSchema>;
