import type { Resource } from "../types.js";
import { pushAgentSkills } from "./api.js";
import { readAllAgentSkills } from "./config.js";
import type { AgentSkill } from "./schema.js";

export const agentSkillResource: Resource<AgentSkill> = {
  readAll: readAllAgentSkills,
  push: pushAgentSkills,
};
