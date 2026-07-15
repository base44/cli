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
type AgentSkillApiResponse = z.infer<typeof AgentSkillApiResponseSchema>;

const ListAgentSkillsResponseSchema = z.object({
  items: z.array(AgentSkillApiResponseSchema),
  total: z.number(),
});
type ListAgentSkillsResponse = z.infer<
  typeof ListAgentSkillsResponseSchema
>;

const SyncAgentSkillsResultSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  deleted: z.array(z.string()),
});
type SyncAgentSkillsResult = z.infer<typeof SyncAgentSkillsResultSchema>;
