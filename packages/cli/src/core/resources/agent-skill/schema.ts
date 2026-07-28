import { z } from "zod";

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const AgentSkillSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      SKILL_NAME_REGEX,
      "Skill name must be lowercase-hyphenated (a-z, 0-9, -)",
    ),
  description: z.string().trim().min(1, "Description is required").max(1024),
  body: z.string().trim().min(1, "Body is required").max(15000),
});

export type AgentSkill = z.infer<typeof AgentSkillSchema>;

const AgentSkillApiResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
});

export const ListAgentSkillsResponseSchema = z.object({
  items: z.array(AgentSkillApiResponseSchema),
  total: z.number(),
});
export type ListAgentSkillsResponse = z.infer<
  typeof ListAgentSkillsResponseSchema
>;

export const SyncAgentSkillsResultSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});
export type SyncAgentSkillsResult = z.infer<typeof SyncAgentSkillsResultSchema>;
