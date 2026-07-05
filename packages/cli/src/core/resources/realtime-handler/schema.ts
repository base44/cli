import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

const RealtimeHandlerConfigSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
});

// A handler's schema.jsonc is a catalog of named messages: `toClient` (server →
// client) and `toServer` (client → server) each map a message name to its (type-less)
// object schema, and optional `types` holds shared shapes referenced via
// `#/types/<Name>`. See the type generator.
export const RealtimeHandlerSchemaFileSchema = z.object({
  types: z.record(z.string(), z.unknown()).optional(),
  toClient: z.record(z.string(), z.unknown()).optional(),
  toServer: z.record(z.string(), z.unknown()).optional(),
});

export const DeployRealtimeHandlerResponseSchema = z.object({
  status: z.enum(["deployed", "unchanged"]),
  handler_name: z.string().optional(),
});

const RealtimeHandlerSchema = RealtimeHandlerConfigSchema.extend({
  entryPath: z.string().min(1),
  filePaths: z.array(z.string()).min(1),
  source: ResourceSourceSchema,
  messageSchema: z.unknown().optional(),
});

export interface RealtimeMessageSchema {
  types?: Record<string, unknown>;
  toClient?: Record<string, unknown>;
  toServer?: Record<string, unknown>;
}

export type RealtimeHandler = Omit<
  z.infer<typeof RealtimeHandlerSchema>,
  "messageSchema"
> & {
  messageSchema?: RealtimeMessageSchema;
};
export type DeployRealtimeHandlerResponse = z.infer<
  typeof DeployRealtimeHandlerResponseSchema
>;
