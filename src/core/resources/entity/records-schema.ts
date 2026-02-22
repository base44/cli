import { z } from "zod";

/**
 * Schema for a single entity record returned by the API.
 * Records are dynamic — data fields depend on the entity schema and are merged at the top level.
 * System fields (id, created_date, updated_date, created_by) are always present.
 */
export const EntityRecordSchema = z.looseObject({
  id: z.string(),
  created_date: z.string(),
  updated_date: z.string(),
  created_by: z.string().optional(),
});

export type EntityRecord = z.infer<typeof EntityRecordSchema>;

/**
 * Schema for the delete response.
 */
export const DeleteRecordResponseSchema = z.object({
  success: z.boolean(),
});

export type DeleteRecordResponse = z.infer<typeof DeleteRecordResponseSchema>;
