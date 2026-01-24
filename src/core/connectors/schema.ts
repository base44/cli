import { z } from "zod";

/**
 * Response from POST /api/apps/{app_id}/external-auth/initiate
 */
export const InitiateResponseSchema = z.object({
  redirect_url: z.string().nullish(),
  connection_id: z.string().nullish(),
  already_authorized: z.boolean().nullish(),
  other_user_email: z.string().nullish(),
  error: z.string().nullish(),
});

export type InitiateResponse = z.infer<typeof InitiateResponseSchema>;

/**
 * Response from GET /api/apps/{app_id}/external-auth/status
 */
export const StatusResponseSchema = z
  .object({
    status: z.enum(["ACTIVE", "PENDING", "FAILED"]),
    account_email: z.string().nullish(),
    error: z.string().nullish(),
  })
  .transform((data) => ({
    status: data.status,
    accountEmail: data.account_email,
    error: data.error,
  }));

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

/**
 * A connected integration from the list endpoint
 */
export const ConnectorSchema = z
  .object({
    integration_type: z.string(),
    status: z.string(),
    connected_at: z.string().nullish(),
    account_info: z
      .object({
        email: z.string().nullish(),
        name: z.string().nullish(),
      })
      .nullish(),
  })
  .transform((data) => ({
    integrationType: data.integration_type,
    status: data.status,
    connectedAt: data.connected_at,
    accountInfo: data.account_info,
  }));

export type Connector = z.infer<typeof ConnectorSchema>;

/**
 * Response from GET /api/apps/{app_id}/external-auth/list
 */
export const ListResponseSchema = z.object({
  integrations: z.array(ConnectorSchema),
});

export type ListResponse = z.infer<typeof ListResponseSchema>;

/**
 * Generic API error response
 */
export const ApiErrorSchema = z.object({
  error: z.string(),
  detail: z.string().nullish(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
