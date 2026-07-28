import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const WORKSPACES = [
  { id: "ws-personal", name: "My Workspace", user_role: "owner" },
  {
    id: "ws-acme",
    name: "Acme Inc",
    user_role: "admin",
    subscription_tier: "enterprise",
  },
];

describe("workspace get command", () => {
  const t = setupCLITests();

  it("shows details for a workspace by id", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces(WORKSPACES);

    const result = await t.run("workspace", "get", "ws-acme");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Acme Inc");
    t.expectResult(result).toContain("ws-acme");
    t.expectResult(result).toContain("enterprise");
  });

  it("emits the workspace as JSON with --json", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces(WORKSPACES);

    const result = await t.run("workspace", "get", "ws-personal", "--json");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      id: "ws-personal",
      name: "My Workspace",
      userRole: "owner",
      isPersonal: true,
    });
  });

  it("fails when the workspace id is unknown", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces(WORKSPACES);

    const result = await t.run("workspace", "get", "ws-nope");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found");
  });
});
