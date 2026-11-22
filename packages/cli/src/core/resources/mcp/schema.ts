import { z } from "zod";

/**
 * The app's MCP config, as written in `base44/mcp/config.json`.
 *
 * Deliberately loose: the platform is the validation authority (unknown keys,
 * tool shapes, profiles, public-server rules) and reports its own message on a
 * bad config. Locally the file only has to be a JSON object — every field is
 * optional, and `{"auth": "oauth"}` is a complete config.
 */
export const McpConfigSchema = z.looseObject({});

export type McpConfig = z.infer<typeof McpConfigSchema>;

/**
 * `GET`/`PUT api/apps/platform/{app_id}/mcp/config`. `tools` and
 * `pending_removal` describe the resolved surface; their item shape belongs to
 * the platform, so it is passed through as given.
 */
export const McpConfigResponseSchema = z
  .looseObject({
    config: McpConfigSchema.nullable(),
    tools: z.array(z.unknown()).default([]),
    pending_removal: z.array(z.unknown()).default([]),
  })
  .transform((data) => ({
    config: data.config,
    tools: data.tools,
    pendingRemoval: data.pending_removal,
  }));

export type McpConfigState = z.infer<typeof McpConfigResponseSchema>;

/** The platform's error envelope: `{error: {code, message, details}}`. */
export const McpErrorEnvelopeSchema = z.object({
  error: z.looseObject({
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
