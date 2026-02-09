import type { Resource } from "../types.js";
import { pushAgents } from "./api.js";
import { readAllAgents } from "./config.js";
import type { AgentConfig } from "./schema.js";

export const agentResource: Resource<AgentConfig> = {
  readAll: readAllAgents,
  push: pushAgents,
};
