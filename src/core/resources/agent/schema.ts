import { z } from "zod";

const EntityOperationSchema = z.enum(["create", "update", "delete", "read"]);

const EntityToolConfigSchema = z.object({
  entity_name: z.string().min(1),
  allowed_operations: z.array(EntityOperationSchema),
});

const BackendFunctionToolConfigSchema = z.object({
  function_name: z.string().min(1),
  description: z.string().default("agent backend function"),
});

const ToolConfigSchema = z.union([
  EntityToolConfigSchema,
  BackendFunctionToolConfigSchema,
]);

export const AgentConfigSchema = z.looseObject({
  name: z.string().regex(/^[a-z0-9_]+$/, "Agent name must be lowercase alphanumeric with underscores").min(1).max(100),
  description: z.string().trim().min(1, "Description is required"),
  instructions: z.string().trim().min(1, "Instructions are required"),
  tool_configs: z.array(ToolConfigSchema).optional().default([]),
  whatsapp_greeting: z.string().nullable().optional(),
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
