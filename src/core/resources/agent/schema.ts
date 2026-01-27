import { z } from "zod";

export const AgentConfigSchema = z.looseObject({
  name: z.string().regex(/^[a-z0-9_]+$/, "Agent name must be lowercase alphanumeric with underscores").min(1).max(100),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const SyncAgentsResponseSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});

export type SyncAgentsResponse = z.infer<typeof SyncAgentsResponseSchema>;

export const AgentConfigApiResponseSchema = z.looseObject({
  name: z.string(),
});

export const ListAgentsResponseSchema = z.object({
  items: z.array(AgentConfigApiResponseSchema),
  total: z.number(),
});

export type AgentConfigApiResponse = z.infer<typeof AgentConfigApiResponseSchema>;
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;
