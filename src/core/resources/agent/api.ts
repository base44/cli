import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  AgentConfig,
  ListAgentsResponse,
  SyncAgentsResponse,
} from "./schema.js";
import {
  ListAgentsResponseSchema,
  SyncAgentsResponseSchema,
} from "./schema.js";

export async function pushAgents(
  agents: AgentConfig[],
): Promise<SyncAgentsResponse> {
  if (agents.length === 0) {
    return { created: [], updated: [], deleted: [] };
  }

  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.put("agent-configs", {
      json: agents,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "syncing agents");
  }

  const result = SyncAgentsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}

export async function fetchAgents(): Promise<ListAgentsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("agent-configs");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching agents");
  }

  const result = ListAgentsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
