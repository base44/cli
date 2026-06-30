import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

export const RealtimeHandlerConfigSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
});

export const DeployRealtimeHandlerResponseSchema = z.object({
  status: z.enum(["deployed", "unchanged"]),
  handler_name: z.string().optional(),
});

const RealtimeHandlerSchema = RealtimeHandlerConfigSchema.extend({
  entryPath: z.string().min(1),
  filePaths: z.array(z.string()).min(1),
  source: ResourceSourceSchema,
});

export type RealtimeHandlerConfig = z.infer<typeof RealtimeHandlerConfigSchema>;
export type RealtimeHandler = z.infer<typeof RealtimeHandlerSchema>;
export type DeployRealtimeHandlerResponse = z.infer<
  typeof DeployRealtimeHandlerResponseSchema
>;
