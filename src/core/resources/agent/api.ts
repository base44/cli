import { getAppClient, formatApiError } from "@/core/clients/index.js";
import { SyncAgentsResponseSchema, ListAgentsResponseSchema } from "./schema.js";
import type { SyncAgentsResponse, AgentConfig, ListAgentsResponse } from "./schema.js";

export async function pushAgents(
  agents: AgentConfig[]
): Promise<SyncAgentsResponse> {
  const appClient = getAppClient();

  const response = await appClient.put("agent-configs", {
    json: agents,
    throwHttpErrors: false,
  });

  if (!response.ok) {
    const errorJson: unknown = await response.json();
    throw new Error(`Error occurred while syncing agents: ${formatApiError(errorJson)}`);
  }

  return SyncAgentsResponseSchema.parse(await response.json());
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
