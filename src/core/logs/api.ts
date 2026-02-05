/**
 * Audit logs API functions.
 */

import type { KyResponse } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/index.js";
import type { AuditLogFilters, AuditLogsResponse } from "./schema.js";
import { AppInfoResponseSchema, AuditLogsResponseSchema } from "./schema.js";

/**
 * Fetch the workspace (organization) ID for the current app.
 * Required because audit logs are fetched at the workspace level.
 */
export async function getWorkspaceId(): Promise<string> {
  const { id: appId } = getAppConfig();

  let response: KyResponse;
  try {
    // GET /api/apps/{app_id} returns app info including organization_id
    response = await base44Client.get(`api/apps/${appId}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching app info");
  }

  const result = AppInfoResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid app info response from server",
      result.error
    );
  }

  return result.data.organization_id;
}

/**
 * Build the API request body from CLI filter options.
 * Transforms camelCase options to snake_case for the API.
 */
function buildRequestBody(
  appId: string,
  filters: AuditLogFilters
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    app_id: appId,
    order: filters.order ?? "DESC",
    limit: filters.limit ?? 50,
  };

  if (filters.status) {
    body.status = filters.status;
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    body.event_types = filters.eventTypes;
  }
  if (filters.userEmail) {
    body.user_email = filters.userEmail;
  }
  if (filters.since) {
    body.start_date = filters.since;
  }
  if (filters.until) {
    body.end_date = filters.until;
  }
  if (filters.cursorTimestamp) {
    body.cursor_timestamp = filters.cursorTimestamp;
  }
  if (filters.cursorUserEmail) {
    body.cursor_user_email = filters.cursorUserEmail;
  }

  return body;
}

/**
 * Fetch audit logs for the current app.
 */
export async function fetchAuditLogs(
  filters: AuditLogFilters = {}
): Promise<AuditLogsResponse> {
  const { id: appId } = getAppConfig();
  const workspaceId = await getWorkspaceId();

  let response: KyResponse;
  try {
    response = await base44Client.post(
      `api/workspace/audit-logs/list?workspaceId=${workspaceId}`,
      {
        json: buildRequestBody(appId, filters),
      }
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching audit logs");
  }

  const result = AuditLogsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid audit logs response from server",
      result.error
    );
  }

  return result.data;
}
