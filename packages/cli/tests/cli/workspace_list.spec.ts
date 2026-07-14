import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("workspace list command", () => {
  const t = setupCLITests();

  it("lists the workspaces the user belongs to", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces([
      { id: "ws-personal", name: "My Workspace", user_role: "owner" },
      { id: "ws-acme", name: "Acme Inc", user_role: "admin" },
    ]);

    const result = await t.run("workspace", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("My Workspace");
    t.expectResult(result).toContain("Acme Inc");
    t.expectResult(result).toContain("ws-acme");
    t.expectResult(result).toContain("2 workspaces");
  });

  it("emits a JSON array with --json (personal workspace flagged first)", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces([
      { id: "ws-personal", name: "My Workspace", user_role: "owner" },
      { id: "ws-acme", name: "Acme Inc", user_role: "editor" },
    ]);

    const result = await t.run("workspace", "list", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: "ws-personal",
      userRole: "owner",
      isPersonal: true,
    });
    expect(parsed[1]).toMatchObject({ id: "ws-acme", isPersonal: false });
  });

  it("filters to workspaces the user can create apps in with --can-create", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces([
      { id: "ws-personal", name: "My Workspace", user_role: "owner" },
      { id: "ws-acme", name: "Acme Inc", user_role: "editor" },
      { id: "ws-view", name: "View Only", user_role: "viewer" },
    ]);

    const result = await t.run("workspace", "list", "--can-create", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.map((w: { id: string }) => w.id)).toEqual([
      "ws-personal",
      "ws-acme",
    ]);
  });

  it("filters by exact role with --role", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces([
      { id: "ws-personal", name: "My Workspace", user_role: "owner" },
      { id: "ws-acme", name: "Acme Inc", user_role: "admin" },
      { id: "ws-globex", name: "Globex", user_role: "admin" },
    ]);

    const result = await t.run("workspace", "list", "--role", "admin", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.map((w: { id: string }) => w.id)).toEqual([
      "ws-acme",
      "ws-globex",
    ]);
  });

  it("fails when the server returns an error", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspacesError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("workspace", "list");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Server error");
  });
});
