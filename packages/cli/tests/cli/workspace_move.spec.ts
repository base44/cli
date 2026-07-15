import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("workspace move command", () => {
  const t = setupCLITests();

  it("moves the linked app to the target workspace", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockMoveApp({
      success: true,
      app_id: "test-app-id",
      new_workspace_id: "ws-acme",
    });

    const result = await t.run("workspace", "move", "ws-acme");

    t.expectResult(result).toSucceed();
    expect(stripAnsi(result.stdout).trim()).toBe("App moved to ws-acme");
  });

  it("emits the move result as JSON with --json", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockMoveApp({
      success: true,
      app_id: "test-app-id",
      new_workspace_id: "ws-acme",
    });

    const result = await t.run("workspace", "move", "ws-acme", "--json");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      success: true,
      appId: "test-app-id",
      newWorkspaceId: "ws-acme",
    });
  });

  it("requires a target workspace id in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("workspace", "move");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "A target workspace ID is required in non-interactive mode",
    );
  });

  it("surfaces the server's block reason instead of validating client-side", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockMoveAppError({
      status: 403,
      body: {
        detail:
          "Only workspace admins and owners can move apps out of this workspace",
      },
    });

    const result = await t.run("workspace", "move", "ws-acme");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Only workspace admins and owners can move apps out of this workspace",
    );
  });
});
