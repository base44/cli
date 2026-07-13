import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const WORKSPACES = [
  { id: "ws-personal", name: "My Workspace", user_role: "owner" },
  { id: "ws-acme", name: "Acme Inc", user_role: "admin" },
];

describe("workspace move command", () => {
  const t = setupCLITests();

  it("moves the linked app to a target workspace", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockListWorkspaces(WORKSPACES);
    t.api.mockGetApp({
      id: "test-app-id",
      name: "My App",
      organization_id: "ws-personal",
    });
    t.api.mockMoveApp({
      success: true,
      message: "App successfully moved to workspace",
      app_id: "test-app-id",
      new_workspace_id: "ws-acme",
    });

    const result = await t.run("workspace", "move", "ws-acme");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Acme Inc");
  });

  it("emits the move result as JSON with --json", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockListWorkspaces(WORKSPACES);
    t.api.mockGetApp({ id: "test-app-id", organization_id: "ws-personal" });
    t.api.mockMoveApp({
      success: true,
      app_id: "test-app-id",
      new_workspace_id: "ws-acme",
    });

    const result = await t.run("workspace", "move", "ws-acme", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ success: true, newWorkspaceId: "ws-acme" });
  });

  it("requires a target workspace id in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockListWorkspaces(WORKSPACES);
    t.api.mockGetApp({ id: "test-app-id", organization_id: "ws-personal" });

    const result = await t.run("workspace", "move");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("target workspace ID is required");
  });

  it("fails when the target workspace is unknown", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockListWorkspaces(WORKSPACES);
    t.api.mockGetApp({ id: "test-app-id", organization_id: "ws-personal" });

    const result = await t.run("workspace", "move", "ws-nope");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found");
  });

  it("fails when the app is already in the target workspace", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockListWorkspaces(WORKSPACES);
    t.api.mockGetApp({ id: "test-app-id", organization_id: "ws-acme" });

    const result = await t.run("workspace", "move", "ws-acme");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("already in that workspace");
  });

  it("surfaces a permission error from the server", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockListWorkspaces(WORKSPACES);
    t.api.mockGetApp({ id: "test-app-id", organization_id: "ws-personal" });
    t.api.mockMoveAppError({
      status: 403,
      body: { detail: "You don't have permission to move this app" },
    });

    const result = await t.run("workspace", "move", "ws-acme");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("permission");
  });
});
