import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("workflows list command", () => {
  const t = setupCLITests();

  it("--json emits the workflows as camelCase records", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowsList([
      {
        id: "wf-1",
        name: "nightly-sync",
        status: "active",
        total_runs: 12,
        consecutive_failures: 3,
        last_run_at: "2026-08-04T03:00:00+00:00",
        last_run_status: "failed",
      },
    ]);

    const result = await t.run("workflows", "list", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].totalRuns).toBe(12);
    expect(parsed.workflows[0].consecutiveFailures).toBe(3);
    expect(parsed.workflows[0].lastRunStatus).toBe("failed");
  });

  it("lists workflows with run summary", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowsList([
      {
        id: "wf-1",
        name: "nightly-sync",
        status: "active",
        total_runs: 12,
        consecutive_failures: 3,
        last_run_at: "2026-08-04T03:00:00+00:00",
        last_run_status: "failed",
      },
      { id: "wf-2", name: "weekly-digest", status: "paused" },
    ]);

    const result = await t.run("workflows", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("nightly-sync");
    t.expectResult(result).toContain("3 consecutive failures");
    t.expectResult(result).toContain("weekly-digest");
    t.expectResult(result).toContain("never ran");
    t.expectResult(result).toContain("Found 2 workflows");
  });

  it("handles an app with no workflows", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowsList([]);

    const result = await t.run("workflows", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("no workflows");
  });

  it("--limit is sent to the API", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowsList([]);

    const result = await t.run("workflows", "list", "--limit", "200");

    t.expectResult(result).toSucceed();
    expect(t.api.workflowsListRequests[0]).toMatchObject({ limit: "200" });
  });

  it("rejects an out-of-range limit", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("workflows", "list", "--limit", "500");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("between 1 and 200");
  });

  it("explains apps that predate Workflows instead of a bare 403", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowsListError({
      status: 403,
      body: { detail: "Workflows are not enabled for this app" },
    });

    const result = await t.run("workflows", "list");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Workflows are not enabled");
  });
});
