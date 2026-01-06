import { z } from 'zod';

const ColumnSchema = z.looseObject({
  name: z.string().min(1, 'Column name cannot be empty'),
  type: z.string().min(1, 'Column type cannot be empty'),
})

export const EntitySchema = z.looseObject({
  id: z.string().min(1, 'Entity ID cannot be empty'),
  name: z.string().min(1, 'Entity name cannot be empty'),
  columns: z.array(ColumnSchema).min(0),
})

export type Entity = z.infer<typeof EntitySchema>;
export type EntityColumn = z.infer<typeof ColumnSchema>;

