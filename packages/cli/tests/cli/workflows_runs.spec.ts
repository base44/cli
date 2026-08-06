import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const failedRun = {
  run_id: "run-failed-1",
  workflow_id: "wf-boom",
  workflow_name: "probe-boom-wf",
  trigger_type: "manual",
  status: "failed",
  started_at: "2026-08-04T13:45:57.423000+00:00",
  completed_at: "2026-08-04T13:46:22.949000+00:00",
  duration_ms: 25525,
  steps_count: 0,
  error_message:
    "Task 'call_fn' failed: Backend function 'auto-boom' returned HTTP 500",
  is_test_run: true,
  status_reason: "",
};

const completedRun = {
  run_id: "run-ok-1",
  workflow_id: "wf-ok",
  workflow_name: "probe-ok-wf",
  trigger_type: "scheduled",
  status: "completed",
  started_at: "2026-08-04T13:45:56.770000+00:00",
  completed_at: "2026-08-04T13:46:10.000000+00:00",
  duration_ms: 13230,
  steps_count: 1,
  error_message: "",
  is_test_run: false,
  status_reason: "",
};

describe("workflows runs command", () => {
  const t = setupCLITests();

  it("--json emits the runs as camelCase records", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRuns([failedRun, completedRun]);

    const result = await t.run("workflows", "runs", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0].runId).toBe("run-failed-1");
    expect(parsed.runs[0].workflowName).toBe("probe-boom-wf");
    expect(parsed.runs[0].isTestRun).toBe(true);
    expect(parsed.runs[1].triggerType).toBe("scheduled");
  });

  it("lists runs with status, trigger, test marker, and failure details", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRuns([failedRun, completedRun]);

    const result = await t.run("workflows", "runs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("FAILED");
    t.expectResult(result).toContain("probe-boom-wf");
    t.expectResult(result).toContain("(manual, test)");
    t.expectResult(result).toContain("Task 'call_fn' failed");
    t.expectResult(result).toContain("COMPLETED");
    t.expectResult(result).toContain("(scheduled)");
    t.expectResult(result).toContain("Found 2 runs");
  });

  it("--status failed is sent to the API", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRuns([failedRun]);

    const result = await t.run("workflows", "runs", "--status", "failed");

    t.expectResult(result).toSucceed();
    expect(t.api.workflowRunsRequests[0]).toMatchObject({ status: "failed" });
  });

  it("rejects an unknown --status value", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("workflows", "runs", "--status", "exploded");

    t.expectResult(result).toFail();
  });

  it("--since accepts relative shorthand and sends an ISO datetime", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRuns([]);
    t.api.mockWorkflowsList([]);

    const result = await t.run("workflows", "runs", "--since", "1h");

    t.expectResult(result).toSucceed();
    const sent = t.api.workflowRunsRequests[0]?.since;
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("rejects an out-of-range limit", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("workflows", "runs", "--limit", "500");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("between 1 and 200");
  });

  it("empty result names the existing workflows", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRuns([]);
    t.api.mockWorkflowsList([
      { id: "wf-1", name: "nightly-sync", status: "active" },
      { id: "wf-2", name: "weekly-digest", status: "active" },
    ]);

    const result = await t.run("workflows", "runs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No runs yet");
    t.expectResult(result).toContain("nightly-sync");
    t.expectResult(result).toContain("weekly-digest");
  });

  it("empty result on an app with no workflows says so", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRuns([]);
    t.api.mockWorkflowsList([]);

    const result = await t.run("workflows", "runs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("no workflows");
  });

  it("explains apps that predate Workflows instead of a bare 403", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockWorkflowRunsError({
      status: 403,
      body: { detail: "Workflows are not enabled for this app" },
    });

    const result = await t.run("workflows", "runs");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Workflows are not enabled");
  });

  it("fails on an invalid API response", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    // biome-ignore lint/suspicious/noExplicitAny: this is a test
    t.api.mockWorkflowRuns([{ bad: "data" }] as any);

    const result = await t.run("workflows", "runs");

    t.expectResult(result).toFail();
  });
});
