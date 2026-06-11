import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agents pull command", () => {
  const t = setupCLITests();

  it("reports no agents when remote has none", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsFetch({ items: [], total: 0 });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("All agents are already up to date");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
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
    t.expectResult(result).toContain("Agent files synced successfully");
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

  it("writes agent files to disk after pull", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentsFetch({
      items: [
        {
          name: "support_agent",
          description: "Helps users",
          instructions: "Be helpful",
        },
      ],
      total: 1,
    });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();

    expect(await t.fileExists("base44/agents/support_agent.jsonc")).toBe(true);

    const fileContent = await t.readProjectFile(
      "base44/agents/support_agent.jsonc",
    );
    const parsed = JSON.parse(fileContent!);
    expect(parsed.name).toBe("support_agent");
    expect(parsed.description).toBe("Helps users");
    expect(parsed.instructions).toBe("Be helpful");
  });

  it("skips unchanged agents and preserves file content", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents-for-pull"));
    t.api.mockAgentsFetch({
      items: [
        {
          name: "support_agent",
          description: "Helps users",
          instructions: "Be helpful",
        },
      ],
      total: 1,
    });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("All agents are already up to date");

    // The file should not have been rewritten — JSONC comment must still be present
    const fileContent = await t.readProjectFile(
      "base44/agents/support_agent.jsonc",
    );
    expect(fileContent).toContain("// My support agent");
  });

  it("succeeds when a new remote agent's default filename clashes with an existing custom-named file", async () => {
    // Local: custom_name.jsonc has name "support_agent" (custom filename)
    // Remote returns support_agent (maps to custom_name.jsonc) AND custom_name
    // (new agent whose default path custom_name.jsonc is already taken — overwrites)
    await t.givenLoggedInWithProject(fixture("with-agents-naming-clash"));
    t.api.mockAgentsFetch({
      items: [
        {
          name: "support_agent",
          description: "Helps users",
          instructions: "Be helpful",
        },
        {
          name: "custom_name",
          description: "A new agent",
          instructions: "Do new things",
        },
      ],
      total: 2,
    });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();
  });

  it("updates agent file in-place when remote data changes", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents-for-pull"));
    t.api.mockAgentsFetch({
      items: [
        {
          name: "support_agent",
          description: "Updated description",
          instructions: "Updated instructions",
        },
      ],
      total: 1,
    });

    const result = await t.run("agents", "pull");

    t.expectResult(result).toSucceed();

    // File should be updated at the same path (in-place)
    expect(await t.fileExists("base44/agents/support_agent.jsonc")).toBe(true);

    const fileContent = await t.readProjectFile(
      "base44/agents/support_agent.jsonc",
    );
    const parsed = JSON.parse(fileContent!);
    expect(parsed.description).toBe("Updated description");
    expect(parsed.instructions).toBe("Updated instructions");
  });
});
