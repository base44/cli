import { describe, expect, it } from "vitest";
import {
  type FollowState,
  type LogEntry,
  selectNewEntries,
} from "@/cli/commands/project/logs.js";
import { fixture, setupCLITests } from "./testkit/index.js";

function entry(time: string, message: string): LogEntry {
  return { time, level: "info", message, source: "fn" };
}

describe("selectNewEntries (follow dedup)", () => {
  const empty: FollowState = { lastTime: "", boundaryKeys: new Set() };

  it("returns all entries on the first poll and tracks the boundary", () => {
    const entries = [
      entry("2024-01-15T10:00:00Z", "a"),
      entry("2024-01-15T10:00:01Z", "b"),
    ];
    const { fresh, nextState } = selectNewEntries(entries, empty);

    expect(fresh).toHaveLength(2);
    expect(nextState.lastTime).toBe("2024-01-15T10:00:01Z");
    expect(nextState.boundaryKeys.has("2024-01-15T10:00:01Z b")).toBe(true);
  });

  it("drops entries already shown at the boundary timestamp", () => {
    const first = selectNewEntries(
      [entry("2024-01-15T10:00:01Z", "b")],
      empty,
    ).nextState;

    const { fresh, nextState } = selectNewEntries(
      [entry("2024-01-15T10:00:01Z", "b"), entry("2024-01-15T10:00:02Z", "c")],
      first,
    );

    expect(fresh.map((e) => e.message)).toEqual(["c"]);
    expect(nextState.lastTime).toBe("2024-01-15T10:00:02Z");
  });

  it("keeps a new entry sharing the boundary timestamp", () => {
    const first = selectNewEntries(
      [entry("2024-01-15T10:00:01Z", "b")],
      empty,
    ).nextState;

    const { fresh, nextState } = selectNewEntries(
      [entry("2024-01-15T10:00:01Z", "b"), entry("2024-01-15T10:00:01Z", "b2")],
      first,
    );

    expect(fresh.map((e) => e.message)).toEqual(["b2"]);
    expect(nextState.boundaryKeys.has("2024-01-15T10:00:01Z b")).toBe(true);
    expect(nextState.boundaryKeys.has("2024-01-15T10:00:01Z b2")).toBe(true);
  });

  it("returns nothing and preserves state when no new entries arrive", () => {
    const first = selectNewEntries(
      [entry("2024-01-15T10:00:01Z", "b")],
      empty,
    ).nextState;

    const { fresh, nextState } = selectNewEntries(
      [entry("2024-01-15T10:00:01Z", "b")],
      first,
    );

    expect(fresh).toHaveLength(0);
    expect(nextState).toBe(first);
  });
});

describe("logs command", () => {
  const t = setupCLITests();

  it("fetches and displays function logs when --function is specified", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Processing request",
      },
      {
        time: "2024-01-15T10:30:00.050Z",
        level: "error",
        message: "Something went wrong",
      },
    ]);

    const result = await t.run("logs", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Showing 2 function log entries");
    t.expectResult(result).toContain("Processing request");
    t.expectResult(result).toContain("Something went wrong");
  });

  it("fetches logs for multiple functions with --function comma-separated", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("fn1", [
      { time: "2024-01-15T10:30:00Z", level: "info", message: "From fn1" },
    ]);
    t.api.mockFunctionLogs("fn2", [
      { time: "2024-01-15T10:29:00Z", level: "info", message: "From fn2" },
    ]);

    const result = await t.run("logs", "--function", "fn1,fn2");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("From fn1");
    t.expectResult(result).toContain("From fn2");
  });

  it("fetches logs for all project functions when no --function specified", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.api.mockFunctionLogs("hello", [
      { time: "2024-01-15T10:29:00Z", level: "info", message: "Hello world" },
    ]);

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Hello world");
  });

  it("fetches logs for path-named (zero-config) function", async () => {
    await t.givenLoggedInWithProject(fixture("with-zero-config-functions"));
    t.api.mockFunctionLogs("foo/bar", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Path-named function log",
      },
    ]);

    const result = await t.run("logs", "--function", "foo/bar");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Path-named function log");
  });

  it("fetches logs for a specified function with --app-id outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "my-function",
          deployment_id: "d1",
          entry: "entry.ts",
          files: [{ path: "entry.ts", content: "" }],
          automations: [],
        },
      ],
    });
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Projectless flag log",
      },
    ]);

    const result = await t.run(
      "logs",
      "--app-id",
      t.api.appId,
      "--function",
      "my-function",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Projectless flag log");
  });

  it("fetches logs for a specified function with BASE44_APP_ID outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenEnv({ BASE44_APP_ID: t.api.appId });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "my-function",
          deployment_id: "d1",
          entry: "entry.ts",
          files: [{ path: "entry.ts", content: "" }],
          automations: [],
        },
      ],
    });
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Projectless env log",
      },
    ]);

    const result = await t.run("logs", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Projectless env log");
  });

  it("fetches logs for all remote functions with --app-id outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "remote-fn",
          deployment_id: "d1",
          entry: "entry.ts",
          files: [{ path: "entry.ts", content: "" }],
          automations: [],
        },
      ],
    });
    t.api.mockFunctionLogs("remote-fn", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Remote function log",
      },
    ]);

    const result = await t.run("logs", "--app-id", t.api.appId);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Remote function log");
  });

  it("shows no functions message when project has no functions", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No functions found in this project");
  });

  it("shows no logs message when empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", []);

    const result = await t.run("logs", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No logs found matching the filters.");
  });

  it("accepts --env prod and shows the published-app hint when empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", []);

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--env",
      "prod",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No production logs found");
  });

  it("rejects --follow combined with --order", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--follow",
      "--order",
      "asc",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--order cannot be combined");
  });

  it("rejects --follow combined with --until", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--follow",
      "--until",
      "1h",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--until cannot be combined");
  });

  it("rejects an invalid --env value", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--env",
      "staging",
    );

    t.expectResult(result).toFail();
  });

  it("filters function logs by --level", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.050Z",
        level: "error",
        message: "Error message",
      },
    ]);

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--level",
      "error",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Error message");
  });

  it("drops other levels client-side when the backend ignores --level", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    // The mock, like per-app Cloudflare deployments, ignores the level query
    // param and returns the full stream.
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.050Z",
        level: "error",
        message: "Error message",
      },
      {
        time: "2024-01-15T10:30:01.050Z",
        level: "info",
        message: "Info message",
      },
      {
        time: "2024-01-15T10:30:02.050Z",
        // The wire value predates schema normalization to "warning".
        level: "warn" as "warning",
        message: "Warn message normalized to warning",
      },
    ]);

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--level",
      "error",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Error message");
    t.expectResult(result).toNotContain("Info message");
    t.expectResult(result).toNotContain("Warn message");
  });

  it("keeps normalized warn entries when filtering by --level warning", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.050Z",
        level: "warn" as "warning",
        message: "Warn message",
      },
      {
        time: "2024-01-15T10:30:01.050Z",
        level: "info",
        message: "Info message",
      },
    ]);

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--level",
      "warning",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Warn message");
    t.expectResult(result).toNotContain("Info message");
  });

  it("fails with invalid level option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "logs",
      "--function",
      "dummy",
      "--level",
      "invalid",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("is invalid");
  });

  it("accepts 'warning' level values from Deno Deploy", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "warning",
        message: "A warning from Deno",
      },
    ]);

    const result = await t.run("logs", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("A warning from Deno");
    t.expectResult(result).toContain("WARNING");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("logs");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("fails when API returns error for function logs", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsError("my-function", {
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("logs", "--function", "my-function");

    t.expectResult(result).toFail();
  });

  it("fails with invalid limit option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("logs", "--limit", "9999");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid limit");
  });

  it("fails with invalid order option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("logs", "--order", "RANDOM");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("is invalid");
  });

  it("passes filter options to API", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", []);

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--limit",
      "10",
      "--order",
      "asc",
    );

    t.expectResult(result).toSucceed();
  });

  it("outputs valid JSON with --json", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      { time: "2024-01-15T10:30:00.000Z", level: "info", message: "Hello" },
    ]);

    const result = await t.run("logs", "--function", "my-function", "--json");

    t.expectResult(result).toSucceed();
    const stdout = result.stdout ?? "";
    const jsonStart = stdout.indexOf("[");
    const parsed = JSON.parse(stdout.slice(jsonStart));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].message).toContain("Hello");
  });

  it("accepts relative time shortcuts for --since", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      { time: "2024-01-15T10:30:00.000Z", level: "info", message: "Recent" },
    ]);

    const result = await t.run(
      "logs",
      "--function",
      "my-function",
      "--since",
      "1h",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Recent");
  });
});
