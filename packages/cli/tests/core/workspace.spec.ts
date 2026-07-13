import { describe, expect, it } from "vitest";
import {
  canCreateAppsInWorkspace,
  MoveAppResponseSchema,
  WorkspaceListResponseSchema,
} from "@/core/workspace/index.js";

describe("workspace schema", () => {
  it("transforms the workspaces list response to camelCase", () => {
    const parsed = WorkspaceListResponseSchema.parse({
      workspaces: [
        {
          id: "ws-1",
          name: "Personal",
          user_role: "owner",
          subscription_tier: "free",
          is_enterprise: false,
        },
      ],
    });

    expect(parsed.workspaces[0]).toEqual({
      id: "ws-1",
      name: "Personal",
      userRole: "owner",
      subscriptionTier: "free",
      isEnterprise: false,
    });
  });

  it("defaults optional workspace fields to undefined", () => {
    const parsed = WorkspaceListResponseSchema.parse({
      workspaces: [{ id: "ws-1", name: "Personal" }],
    });

    expect(parsed.workspaces[0]).toEqual({
      id: "ws-1",
      name: "Personal",
      userRole: undefined,
      subscriptionTier: undefined,
      isEnterprise: undefined,
    });
  });

  it("transforms the move response to camelCase", () => {
    const parsed = MoveAppResponseSchema.parse({
      success: true,
      message: "moved",
      app_id: "app-1",
      new_workspace_id: "ws-2",
    });

    expect(parsed).toEqual({
      success: true,
      message: "moved",
      appId: "app-1",
      newWorkspaceId: "ws-2",
    });
  });
});

describe("canCreateAppsInWorkspace", () => {
  it("allows editor-capable roles (case-insensitive)", () => {
    for (const role of ["owner", "admin", "editor", "OWNER", "Admin"]) {
      expect(canCreateAppsInWorkspace(role)).toBe(true);
    }
  });

  it("denies viewer, guest, unknown, and missing roles", () => {
    for (const role of ["viewer", "guest", "member", undefined]) {
      expect(canCreateAppsInWorkspace(role)).toBe(false);
    }
  });
});
