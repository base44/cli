import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  ListWorkflowRunsResponse,
  ListWorkflowsResponse,
  WorkflowRunFilters,
} from "./schema.js";
import {
  ListWorkflowRunsResponseSchema,
  ListWorkflowsResponseSchema,
} from "./schema.js";

export async function listWorkflows(
  limit?: number,
): Promise<ListWorkflowsResponse> {
  const appClient = getAppClient();

  const searchParams = new URLSearchParams();
  if (limit !== undefined) {
    searchParams.set("limit", String(limit));
  }

  let response: KyResponse;
  try {
    response = await appClient.get("workflows", { searchParams });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing workflows");
  }

  const result = ListWorkflowsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid workflows response from server",
      result.error,
    );
  }

  return result.data;
}

function buildRunsQueryString(filters: WorkflowRunFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.since) {
    params.set("since", filters.since);
  }
  if (filters.limit !== undefined) {
    params.set("limit", String(filters.limit));
  }

  return params;
}

export async function listWorkflowRuns(
  filters: WorkflowRunFilters = {},
): Promise<ListWorkflowRunsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("workflows/runs", {
      searchParams: buildRunsQueryString(filters),
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing workflow runs");
  }

  const result = ListWorkflowRunsResponseSchema.safeParse(
    await response.json(),
  );

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid workflow runs response from server",
      result.error,
    );
  }

  return result.data;
}
