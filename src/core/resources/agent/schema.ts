import { z } from "zod";

export const EntityToolConfigSchema = z.object({
  entity_name: z.string().min(1),
  allowed_operations: z.array(z.enum(["read", "create", "update", "delete"])).default([]),
});

export const BackendFunctionToolConfigSchema = z.object({
  function_name: z.string().min(1),
  description: z.string().default("agent backend function"),
});

export const ToolConfigSchema = z.union([
  EntityToolConfigSchema,
  BackendFunctionToolConfigSchema,
]);

export const AgentConfigSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/, "Agent name must be lowercase alphanumeric with underscores").min(1).max(100),
  description: z.string().min(1, "Agent description cannot be empty"),
  instructions: z.string().min(1, "Agent instructions cannot be empty"),
  tool_configs: z.array(ToolConfigSchema).default([]),
  whatsapp_greeting: z.string().nullable().optional(),
});

export type EntityToolConfig = z.infer<typeof EntityToolConfigSchema>;
export type BackendFunctionToolConfig = z.infer<typeof BackendFunctionToolConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const SyncAgentsResponseSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});

export type SyncAgentsResponse = z.infer<typeof SyncAgentsResponseSchema>;

export const AgentConfigApiResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  tool_configs: z.array(ToolConfigSchema).default([]),
  whatsapp_greeting: z.string().nullable().optional(),
});

export const ListAgentsResponseSchema = z.object({
  items: z.array(AgentConfigApiResponseSchema),
  total: z.number(),
});

export type AgentConfigApiResponse = z.infer<typeof AgentConfigApiResponseSchema>;
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;
