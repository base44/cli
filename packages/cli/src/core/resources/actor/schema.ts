import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

const ActorConfigSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
});

// An actor's schema.jsonc is a catalog of named messages: `toClient` (server →
// client) and `toServer` (client → server) each map a message name to its (type-less)
// object schema, and optional `types` holds shared shapes referenced via
// `#/types/<Name>`. See the type generator.
export const ActorSchemaFileSchema = z.object({
  types: z.record(z.string(), z.unknown()).optional(),
  toClient: z.record(z.string(), z.unknown()).optional(),
  toServer: z.record(z.string(), z.unknown()).optional(),
});

export const DeployActorResponseSchema = z.object({
  status: z.enum(["deployed", "unchanged"]),
  handler_name: z.string().optional(),
});

const ActorSchema = ActorConfigSchema.extend({
  entryPath: z.string().min(1),
  filePaths: z.array(z.string()).min(1),
  source: ResourceSourceSchema,
  messageSchema: z.unknown().optional(),
});

export interface ActorMessageSchema {
  types?: Record<string, unknown>;
  toClient?: Record<string, unknown>;
  toServer?: Record<string, unknown>;
}

export type Actor = Omit<z.infer<typeof ActorSchema>, "messageSchema"> & {
  messageSchema?: ActorMessageSchema;
};
export type DeployActorResponse = z.infer<typeof DeployActorResponseSchema>;
