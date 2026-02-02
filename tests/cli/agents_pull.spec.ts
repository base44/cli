import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agents pull command", () => {
  const t = setupCLITests();

  it("reports no agents when remote has none", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsFetch({ items: [], total: 0 });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No agents found on Base44");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("pulls agents successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsFetch({
      items: [
        { name: "support_agent", description: "Helps users" },
        { name: "sales_agent", description: "Handles sales" },
      ],
      total: 2,
    });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agents fetched successfully");
    t.expectResult(result).toContain("Agent files written successfully");
    t.expectResult(result).toContain("Pulled 2 agents");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsFetchError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toFail();
  });
});
