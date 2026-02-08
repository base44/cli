import { z } from "zod";

/**
 * Single audit log event from the API response.
 */
export const AuditLogEventSchema = z.looseObject({
  timestamp: z.string(),
  user_email: z.string().nullable(),
  workspace_id: z.string(),
  app_id: z.string(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  event_type: z.string(),
  status: z.enum(["success", "failure"]),
  error_code: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export type AuditLogEvent = z.infer<typeof AuditLogEventSchema>;

/**
 * Pagination cursor for fetching the next page.
 */
export const PaginationCursorSchema = z.object({
  timestamp: z.string(),
  user_email: z.string(),
});

/**
 * Pagination info from the API response.
 */
export const PaginationSchema = z.object({
  total: z.number(),
  limit: z.number(),
  has_more: z.boolean(),
  next_cursor: PaginationCursorSchema.nullable(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * Full audit logs API response.
 */
export const AuditLogsResponseSchema = z.object({
  events: z.array(AuditLogEventSchema),
  pagination: PaginationSchema,
});

export type AuditLogsResponse = z.infer<typeof AuditLogsResponseSchema>;

/**
 * App info response schema (for extracting workspace/organization ID).
 */
export const AppInfoResponseSchema = z.looseObject({
  organization_id: z.string(),
});

export type AppInfoResponse = z.infer<typeof AppInfoResponseSchema>;

/**
 * CLI filter options (camelCase for TypeScript).
 * These are transformed to snake_case when building the API request.
 */
export interface AuditLogFilters {
  status?: "success" | "failure";
  eventTypes?: string[];
  userEmail?: string;
  since?: string;
  until?: string;
  limit?: number;
  order?: "ASC" | "DESC";
  cursorTimestamp?: string;
  cursorUserEmail?: string;
}
