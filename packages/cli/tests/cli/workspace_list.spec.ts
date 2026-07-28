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

  it("emits the exact workspaces array with --json (personal flagged first)", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces([
      { id: "ws-personal", name: "My Workspace", user_role: "owner" },
      { id: "ws-acme", name: "Acme Inc", user_role: "editor" },
    ]);

    const result = await t.run("workspace", "list", "--json");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual([
      {
        id: "ws-personal",
        name: "My Workspace",
        userRole: "owner",
        isPersonal: true,
      },
      {
        id: "ws-acme",
        name: "Acme Inc",
        userRole: "editor",
        isPersonal: false,
      },
    ]);
  });

  it("filters by exact role with --role", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListWorkspaces([
      { id: "ws-personal", name: "My Workspace", user_role: "owner" },
      { id: "ws-acme", name: "Acme Inc", user_role: "admin" },
      { id: "ws-globex", name: "Globex", user_role: "admin" },
    ]);

    const result = await t.run(
      "workspace",
      "list",
      "--role",
      "admin",
      "--json",
    );

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual([
      {
        id: "ws-acme",
        name: "Acme Inc",
        userRole: "admin",
        isPersonal: false,
      },
      {
        id: "ws-globex",
        name: "Globex",
        userRole: "admin",
        isPersonal: false,
      },
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
