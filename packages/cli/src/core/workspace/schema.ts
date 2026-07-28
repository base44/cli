import { z } from "zod";

/**
 * A workspace (a.k.a. organization) the current user belongs to.
 *
 * The server returns snake_case; we transform to camelCase. Only the fields the
 * CLI needs are kept — the workspaces endpoint returns a much larger payload.
 */
export const WorkspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    user_role: z.string().nullish(),
    subscription_tier: z.string().nullish(),
    is_enterprise: z.boolean().nullish(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    userRole: data.user_role ?? undefined,
    subscriptionTier: data.subscription_tier ?? undefined,
    isEnterprise: data.is_enterprise ?? undefined,
  }));

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceSchema),
});

/** Response from POST /api/apps/{id}/metadata/move-to-workspace. */
export const MoveAppResponseSchema = z
  .looseObject({
    success: z.boolean().optional(),
    message: z.string().optional(),
    app_id: z.string().optional(),
    new_workspace_id: z.string().optional(),
  })
  .transform((data) => ({
    success: data.success ?? true,
    message: data.message,
    appId: data.app_id,
    newWorkspaceId: data.new_workspace_id,
  }));

export type MoveAppResult = z.infer<typeof MoveAppResponseSchema>;
