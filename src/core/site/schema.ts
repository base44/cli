import { z } from "zod";

/**
 * Response from the deploy API endpoint.
 */
export const DeployResponseSchema = z.object({
  /** Whether the deployment was successful */
  success: z.boolean(),
  /** The app ID */
  app_id: z.string(),
  /** Number of files deployed */
  files_count: z.number(),
  /** Total size of deployed files in bytes */
  total_size_bytes: z.number(),
  /** Timestamp when deployment completed */
  deployed_at: z.string(),
  /** The URL where the site is deployed */
  app_url: z.string().url(),
});

export type DeployResponse = z.infer<typeof DeployResponseSchema>;
