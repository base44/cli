import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agents push command", () => {
  const t = setupCLITests();

  it("warns when no agents found in project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });

    const result = await t.run("agents", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No local agents found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agents", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("finds and lists agents in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockAgentsPush({
      created: ["customer_support", "data_analyst", "order_assistant"],
      updated: [],
      deleted: [],
    });

    const result = await t.run("agents", "push");

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

    const result = await t.run("agents", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agents pushed successfully");
    t.expectResult(result).toContain("Created: customer_support");
    t.expectResult(result).toContain("Updated: data_analyst");
    t.expectResult(result).toContain("Deleted: old_agent");
  });

  it("fails with helpful error when agent has empty name", async () => {
    await t.givenLoggedInWithProject(fixture("invalid-agent"));

    const result = await t.run("agents", "push");

    t.expectResult(result).toFail();
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockAgentsPushError({ status: 401, body: { error: "Unauthorized" } });

    const result = await t.run("agents", "push");

    t.expectResult(result).toFail();
  });
});
