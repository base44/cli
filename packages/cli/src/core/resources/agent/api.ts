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

/**
 * Replaces the app's agent configs with `agents`, deleting any remote agent
 * that is not in the list.
 *
 * An empty list is a meaningful request — it deletes every remote agent — so it
 * is sent to the server like any other. Callers that must not delete everything
 * when a project simply defines no agents are responsible for not calling this
 * with an empty list (see `deployAll`), because a short-circuit here cannot
 * tell that case apart from a deliberate "remove them all".
 */
export async function pushAgents(
  agents: AgentConfig[],
): Promise<SyncAgentsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.put("agent-configs", {
      json: agents,
      timeout: 60_000,
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
