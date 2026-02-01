import { getAppClient } from "@/core/clients/index.js";
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

  let response;
  try {
    response = await appClient.put("agent-configs", {
      json: agents,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "syncing agents");
  }

  const result = SyncAgentsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}

export async function fetchAgents(): Promise<ListAgentsResponse> {
  const appClient = getAppClient();

  let response;
  try {
    response = await appClient.get("agent-configs");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching agents");
  }

  const result = ListAgentsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
