import { z } from "zod";

/**
 * Represents a single file to be deployed.
 * Contains the relative path and base64-encoded content.
 */
export const SiteFileSchema = z.object({
  /** Relative path from output directory (e.g., "index.html", "assets/main.js") */
  path: z.string(),
  /** Base64-encoded file content */
  content: z.string(),
});

export type SiteFile = z.infer<typeof SiteFileSchema>;

/**
 * Response from the deploy API endpoint.
 */
export const DeployResponseSchema = z.object({
  /** The URL where the site is deployed */
  url: z.string().url(),
});

export type DeployResponse = z.infer<typeof DeployResponseSchema>;
