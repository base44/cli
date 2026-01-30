import { getAppClient, formatApiError } from "@/core/clients/index.js";
import { SyncAgentsResponseSchema, ListAgentsResponseSchema } from "./schema.js";
import type { SyncAgentsResponse, AgentConfig, ListAgentsResponse } from "./schema.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

export async function pushAgents(
  agents: AgentConfig[]
): Promise<SyncAgentsResponse> {
  if (agents.length === 0) {
    return { created: [], updated: [], deleted: [] };
  }

  const appClient = getAppClient();

  const response = await appClient.put("agent-configs", {
    json: agents,
    throwHttpErrors: false,
  });

  if (!response.ok) {
    const errorJson: unknown = await response.json();
    throw new ApiError(`Error occurred while syncing agents: ${formatApiError(errorJson)}`, {
      statusCode: response.status,
    });
  }

  const result = SyncAgentsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}

export async function fetchAgents(): Promise<ListAgentsResponse> {
  const appClient = getAppClient();
  const response = await appClient.get("agent-configs", {
    throwHttpErrors: false,
  });

  if (!response.ok) {
    const errorJson: unknown = await response.json();
    throw new ApiError(`Error occurred while fetching agents: ${formatApiError(errorJson)}`, {
      statusCode: response.status,
    });
  }

  const result = ListAgentsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
