import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

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
    t.expectResult(result).toContain("No Base44 project found");
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

  it("fails when --tail is used with --since", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    const result = await t.run(
      "logs",
      "--tail",
      "--since",
      "2024-01-01T00:00:00Z",
    );
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Cannot use --since with --tail");
  });

  it("fails when --tail is used with --until", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    const result = await t.run(
      "logs",
      "--tail",
      "--until",
      "2024-01-01T00:00:00Z",
    );
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Cannot use --until with --tail");
  });

  it("fails when --tail is used with --limit", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    const result = await t.run("logs", "--tail", "--limit", "10");
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Cannot use --limit with --tail");
  });

  it("fails when --tail is used with --order", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    const result = await t.run("logs", "--tail", "--order", "asc");
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Cannot use --order with --tail");
  });

  it("streams logs with --tail and prints entries", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsStream("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Streamed entry 1",
      },
      {
        time: "2024-01-15T10:30:01.000Z",
        level: "error",
        message: "Streamed entry 2",
      },
    ]);

    const result = await t.run("logs", "--tail", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Streamed entry 1");
    t.expectResult(result).toContain("Streamed entry 2");
    t.expectResult(result).toContain("Stream ended");
  });

  it("streams logs with --tail --json and includes source field", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsStream("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "JSON entry",
      },
    ]);

    const result = await t.run(
      "logs",
      "--tail",
      "--json",
      "--function",
      "my-function",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"source":"my-function"');
    t.expectResult(result).toContain('"message":"JSON entry"');
  });

  it("streams logs for multiple functions with --tail", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsStream("fn1", [
      { time: "2024-01-15T10:30:00Z", level: "info", message: "From fn1" },
    ]);
    t.api.mockFunctionLogsStream("fn2", [
      { time: "2024-01-15T10:30:01Z", level: "info", message: "From fn2" },
    ]);

    const result = await t.run("logs", "--tail", "--function", "fn1,fn2");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("[fn1]");
    t.expectResult(result).toContain("[fn2]");
  });

  it("shows error when all --tail streams fail", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsStreamError("my-function", {
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("logs", "--tail", "--function", "my-function");

    t.expectResult(result).toFail();
  });

  it("shows Stream ended when server closes --tail stream", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsStream("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Last entry",
      },
    ]);

    const result = await t.run("logs", "--tail", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Stream ended");
  });

  it("ignores SSE heartbeat comments with --tail", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockRoute(
      "GET",
      `/api/apps/test-app-id/functions-mgmt/my-function/logs/stream`,
      (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": heartbeat\n\n");
        res.write(
          'data: {"time":"2024-01-15T10:30:00Z","level":"info","message":"real entry"}\n\n',
        );
        res.write(": heartbeat\n\n");
        res.end();
      },
    );

    const result = await t.run("logs", "--tail", "--function", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("real entry");
    t.expectResult(result).toNotContain("heartbeat");
  });
});
