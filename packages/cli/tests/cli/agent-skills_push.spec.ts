import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agent-skills push command", () => {
  const t = setupCLITests();

  it("warns when no agent skills found in project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentSkillsFetch({ items: [], total: 0 });

    const result = await t.run("agent-skills", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No local agent skills found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agent-skills", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("finds and lists agent skills in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetch({ items: [], total: 0 });
    t.api.mockAgentSkillsCreate();

    const result = await t.run("agent-skills", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 1 agent skills to push");
  });

  it("pushes agent skills successfully and shows results", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetch({
      items: [
        { name: "old-skill", description: "Old skill", body: "Old body" },
      ],
      total: 1,
    });
    t.api.mockAgentSkillsCreate();
    t.api.mockAgentSkillsUpdate();
    t.api.mockAgentSkillsDelete();

    const result = await t.run("agent-skills", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agent skills pushed");
    t.expectResult(result).toContain("Created: weekly-report");
    t.expectResult(result).toContain("Deleted: old-skill");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetchError({
      status: 401,
      body: { error: "Unauthorized" },
    });

    const result = await t.run("agent-skills", "push");

    t.expectResult(result).toFail();
  });
});
