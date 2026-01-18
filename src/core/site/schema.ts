import { z } from "zod";

/**
 * Response from the deploy API endpoint.
 */
export const DeployResponseSchema = z.object({
  app_url: z.url(),
}).transform((data) => ({
  appUrl: data.app_url
}));

export type DeployResponse = z.infer<typeof DeployResponseSchema>;
