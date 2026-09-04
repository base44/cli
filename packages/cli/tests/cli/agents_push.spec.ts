import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agents push command", () => {
  const t = setupCLITests();

  // A missing agents directory reads the same as an empty one, but it almost
  // always means the command is pointed at the wrong project — so refuse
  // rather than delete every remote agent.
  it("refuses to delete all remote agents when there is no agents directory", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No agents directory found");
    expect(t.api.agentsPushRequests).toEqual([]);
  });

  // The case the "this will delete all remote agents" warning exists for: an
  // agents directory that is deliberately empty really does clear the app.
  it("deletes all remote agents when the agents directory exists but is empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    await mkdir(join(t.getTempDir(), "project", "base44", "agents"), {
      recursive: true,
    });
    t.api.mockAgentsPush({
      created: [],
      updated: [],
      deleted: ["oncall_assistant"],
    });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No local agents found");
    // The destructive sync actually reached the server...
    expect(t.api.agentsPushRequests).toEqual([[]]);
    // ...and the CLI reports what it removed.
    t.expectResult(result).toContain("Deleted: oncall_assistant");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("finds and lists agents in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockAgentsPush({
      created: ["customer_support", "data_analyst", "order_assistant"],
      updated: [],
      deleted: [],
    });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 3 agents to push");
  });

  it("pushes agents successfully and shows results", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockAgentsPush({
      created: ["customer_support"],
      updated: ["data_analyst"],
      deleted: ["old_agent"],
    });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agents pushed successfully");
    t.expectResult(result).toContain("Created: customer_support");
    t.expectResult(result).toContain("Updated: data_analyst");
    t.expectResult(result).toContain("Deleted: old_agent");
  });

  it("fails with helpful error when agent has empty name", async () => {
    await t.givenLoggedInWithProject(fixture("invalid-agent"));

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toFail();
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockAgentsPushError({ status: 401, body: { error: "Unauthorized" } });

    const result = await t.run("agents", "push", "--yes");

    t.expectResult(result).toFail();
  });

  it("fails when --yes is not provided in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));

    const result = await t.run("agents", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--yes is required in non-interactive mode",
    );
  });
});
