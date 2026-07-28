import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("agent-skills pull command", () => {
  const t = setupCLITests();

  it("reports no skills when remote has none", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentSkillsFetch({ items: [], total: 0 });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("All skills are already up to date");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("pulls skills successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentSkillsFetch({
      items: [
        {
          name: "refunds",
          description: "Refund policy",
          body: "Refund within 30 days.",
        },
        {
          name: "shipping",
          description: "Shipping info",
          body: "Ships in 3-5 business days.",
        },
      ],
      total: 2,
    });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Agent skills fetched successfully");
    t.expectResult(result).toContain("Skill files synced successfully");
    t.expectResult(result).toContain("Pulled 2 agent skills");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentSkillsFetchError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toFail();
  });

  it("writes skill files to disk after pull", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAgentSkillsFetch({
      items: [
        {
          name: "refunds",
          description: "Refund policy",
          body: "Refund within 30 days.",
        },
      ],
      total: 1,
    });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toSucceed();

    expect(await t.fileExists("base44/agent-skills/refunds.md")).toBe(true);

    const fileContent = await t.readProjectFile(
      "base44/agent-skills/refunds.md",
    );
    expect(fileContent).toContain("description: Refund policy");
    expect(fileContent).toContain("Refund within 30 days.");
  });

  it("skips unchanged skills and leaves them up to date", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetch({
      items: [
        {
          name: "weekly-report",
          description: "Summarize the week.",
          body: "Read tasks from the last 7 days and group them.",
        },
      ],
      total: 1,
    });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("All skills are already up to date");
  });

  it("updates skill file in-place when remote data changes", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetch({
      items: [
        {
          name: "weekly-report",
          description: "Updated summary",
          body: "Updated instructions.",
        },
      ],
      total: 1,
    });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toSucceed();

    expect(await t.fileExists("base44/agent-skills/weekly-report.md")).toBe(
      true,
    );

    const fileContent = await t.readProjectFile(
      "base44/agent-skills/weekly-report.md",
    );
    expect(fileContent).toContain("description: Updated summary");
    expect(fileContent).toContain("Updated instructions.");
  });

  it("deletes a local skill file that no longer exists remotely", async () => {
    await t.givenLoggedInWithProject(fixture("with-agent-skills"));
    t.api.mockAgentSkillsFetch({ items: [], total: 0 });

    const result = await t.run("agent-skills", "pull");

    t.expectResult(result).toSucceed();
    expect(await t.fileExists("base44/agent-skills/weekly-report.md")).toBe(
      false,
    );
  });
});
