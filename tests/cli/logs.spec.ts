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
      { time: "2024-01-15T10:29:00Z", level: "log", message: "Hello world" },
    ]);

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Hello world");
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

  it("outputs JSON with --json flag", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Test log",
      },
    ]);

    const result = await t.run("logs", "--function", "my-function", "--json");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"time"');
    t.expectResult(result).toContain('"level"');
    t.expectResult(result).toContain('"message"');
    t.expectResult(result).toContain('"source"');
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
});
