import { getAppClient } from "@/core/clients/index.js";
import { formatApiError } from "@/core/errors.js";
import { SyncAgentsResponseSchema, ListAgentsResponseSchema } from "./schema.js";
import type { SyncAgentsResponse, AgentConfig, ListAgentsResponse } from "./schema.js";

export async function pushAgents(
  agents: AgentConfig[]
): Promise<SyncAgentsResponse> {
  const appClient = getAppClient();
  const payload = agents.map((agent) => ({
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    tool_configs: agent.tool_configs,
    whatsapp_greeting: agent.whatsapp_greeting ?? null,
  }));

  const response = await appClient.put("agent-configs", {
    json: payload,
    throwHttpErrors: false,
  });

  if (!response.ok) {
    const errorJson: unknown = await response.json();
    throw new Error(`Error occurred while syncing agents: ${formatApiError(errorJson)}`);
  }

  const result = SyncAgentsResponseSchema.parse(await response.json());

  return result;
}

export async function fetchAgents(): Promise<ListAgentsResponse> {
  const appClient = getAppClient();
  const response = await appClient.get("agent-configs", {
    throwHttpErrors: false,
  });

  if (!response.ok) {
    const errorJson: unknown = await response.json();
    throw new Error(`Error occurred while fetching agents: ${formatApiError(errorJson)}`);
  }

  return ListAgentsResponseSchema.parse(await response.json());
}
