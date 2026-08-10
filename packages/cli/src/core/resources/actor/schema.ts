import { z } from "zod";
import { ResourceSourceSchema } from "@/core/resources/types.js";

const ActorSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
  entryPath: z.string().min(1),
  filePaths: z.array(z.string()).min(1),
  source: ResourceSourceSchema,
});

export const DeployActorResponseSchema = z.object({
  status: z.enum(["deployed", "unchanged"]),
});

export type Actor = z.infer<typeof ActorSchema>;
export type DeployActorResponse = z.infer<typeof DeployActorResponseSchema>;
