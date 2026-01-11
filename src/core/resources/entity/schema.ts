import { z } from "zod";

const EntityPropertySchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  format: z.string().optional(),
  items: z.any().optional(),
  relation: z
    .object({
      entity: z.string(),
      type: z.string(),
    })
    .optional(),
});

const EntityPoliciesSchema = z.object({
  read: z.string().optional(),
  create: z.string().optional(),
  update: z.string().optional(),
  delete: z.string().optional(),
});

export const EntitySchema = z.object({
  name: z.string().min(1, "Entity name cannot be empty"),
  type: z.literal("object"),
  properties: z.record(z.string(), EntityPropertySchema),
  required: z.array(z.string()).optional(),
  policies: EntityPoliciesSchema.optional(),
});

export type EntityProperty = z.infer<typeof EntityPropertySchema>;
export type EntityPolicies = z.infer<typeof EntityPoliciesSchema>;
export type Entity = z.infer<typeof EntitySchema>;

export const SyncEntitiesResponseSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});

export type SyncEntitiesResponse = z.infer<typeof SyncEntitiesResponseSchema>;
