import { z } from "zod";

/** Seed application state; `null` until seeds have been applied. */
export const SeedStateSchema = z
  .object({
    hash: z.string(),
    appliedAt: z.string(),
  })
  .nullable();

export type SeedState = z.infer<typeof SeedStateSchema>;

/** Contents of `<dataDir>/meta.json`. */
export const DataDirMetaSchema = z.object({
  formatVersion: z.literal(1),
  appId: z.string(),
  seed: SeedStateSchema.default(null),
});

export type DataDirMeta = z.infer<typeof DataDirMetaSchema>;

/** Contents of `<projectRoot>/.base44/dev.json` (instance descriptor). */
export const DevInstanceSchema = z.object({
  appId: z.string(),
  url: z.string(),
  port: z.number(),
  pid: z.number(),
  dataDir: z.string(),
  adminToken: z.string(),
  startedAt: z.string(),
  seed: SeedStateSchema.default(null),
});

export type DevInstance = z.infer<typeof DevInstanceSchema>;
