import { z } from "zod";

export const SeedModeSchema = z.enum(["upsert", "replace"]);

export type SeedMode = z.infer<typeof SeedModeSchema>;

/**
 * One entry of `users.jsonc`. Extra keys are custom User-entity fields and
 * flow through to the seeded user document (validated against the User schema
 * at apply time).
 */
export const SeedUserSchema = z.looseObject({
  email: z.email(),
  role: z.enum(["admin", "user"]).default("user"),
  password: z.string().optional(),
  full_name: z.string().optional(),
});

export type SeedUser = z.infer<typeof SeedUserSchema>;

export const SeedUsersFileSchema = z.array(SeedUserSchema);

/**
 * One entry of an entity fixture file. `id` makes the record upsertable by
 * id; `created_by` is a user email resolved at apply time. Everything else is
 * entity data validated against the entity schema at apply time.
 */
export const SeedRecordSchema = z.looseObject({
  id: z.string().min(1).optional(),
  created_by: z.string().optional(),
});

export type SeedRecord = z.infer<typeof SeedRecordSchema>;

export const SeedRecordsFileSchema = z.array(SeedRecordSchema);

export const SeedEntityCountsSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
});

export type SeedEntityCounts = z.infer<typeof SeedEntityCountsSchema>;

/**
 * Result of one seed application. Returned by the applier, the
 * `POST /_base44/dev/seed` admin endpoint, and `base44 dev seed --json`.
 * `script` reports the `seed.ts` step (always null until the script runner
 * lands).
 */
export const SeedSummarySchema = z.object({
  applied: z.boolean(),
  mode: SeedModeSchema,
  users: z.number(),
  records: z.record(z.string(), SeedEntityCountsSchema),
  script: z.object({ ran: z.boolean() }).nullable(),
  warnings: z.array(z.string()),
});

export type SeedSummary = z.infer<typeof SeedSummarySchema>;

/** Summary for a run that found no seed files (nothing to apply). */
export function emptySeedSummary(mode: SeedMode): SeedSummary {
  return {
    applied: false,
    mode,
    users: 0,
    records: {},
    script: null,
    warnings: ["No seed files found"],
  };
}

/**
 * Result of a dev-server reset. Returned by the `POST /_base44/dev/reset`
 * admin endpoint and `base44 dev reset --json`.
 */
export const DevResetResultSchema = z.object({
  reset: z.literal(true),
  seeded: z.boolean(),
  dataDir: z.string(),
  seed: SeedSummarySchema.nullable(),
});

export type DevResetResult = z.infer<typeof DevResetResultSchema>;
