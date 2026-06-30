import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

const RealtimeHandlerConfigSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
});

export const RealtimeHandlerSchemaFileSchema = z.object({
  inbound: z.unknown().optional(),
  outbound: z.unknown().optional(),
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
  inbound?: Record<string, unknown>;
  outbound?: Record<string, unknown>;
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
