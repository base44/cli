import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agent-skills push command", () => {
  const t = setupCLITests();

  it("warns and makes no agent-skills requests when none found in project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("agent-skills", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No local agent skills found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agent-skills", "push", "--yes");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("creates a new skill and shows the result", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetch({ items: [], total: 0 });
    t.api.mockAgentSkillsCreate();

    const result = await t.run("agent-skills", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 1 agent skills to push");
    t.expectResult(result).toContain("Created: weekly-report");
  });

  it("updates changed skills and deletes remote-only skills", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    // Remote has weekly-report (different body -> update) and old-skill (not
    // local -> delete). Local only has weekly-report.
    t.api.mockAgentSkillsFetch({
      items: [
        {
          name: "weekly-report",
          description: "Stale description",
          body: "Stale body that differs from local.",
        },
        { name: "old-skill", description: "Old skill", body: "Old body" },
      ],
      total: 2,
    });
    t.api.mockAgentSkillsUpdate();
    t.api.mockAgentSkillsDelete();

    const result = await t.run("agent-skills", "push", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agent skills pushed");
    t.expectResult(result).toContain("Updated: weekly-report");
    t.expectResult(result).toContain("Deleted: old-skill");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetchError({
      status: 401,
      body: { error: "Unauthorized" },
    });

    const result = await t.run("agent-skills", "push", "--yes");

    t.expectResult(result).toFail();
  });

  it("fails when --yes is not provided in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));

    const result = await t.run("agent-skills", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--yes is required in non-interactive mode",
    );
  });
});
