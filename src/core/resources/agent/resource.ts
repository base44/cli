import type { Resource } from "../types.js";
import type { AgentConfig } from "./schema.js";
import { readAllAgents } from "./config.js";
import { pushAgents } from "./api.js";

export const agentResource: Resource<AgentConfig> = {
  readAll: readAllAgents,
  push: pushAgents,
};
