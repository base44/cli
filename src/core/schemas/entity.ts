import { z } from "zod";

const FieldSchema = z.looseObject({
  name: z.string().min(1, "Field name cannot be empty"),
  type: z.string().min(1, "Field type cannot be empty"),
});

export const EntitySchema = z.looseObject({
  name: z.string().min(1, "Entity name cannot be empty"),
  fields: z.array(FieldSchema).min(0),
});

export type Entity = z.infer<typeof EntitySchema>;
export type EntityField = z.infer<typeof FieldSchema>;
