import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("functions logs command", () => {
  const t = setupCLITests();

  it("fetches and displays logs successfully", async () => {
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

    const result = await t.run("functions", "logs", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logs fetched successfully");
    t.expectResult(result).toContain('Showing 2 log entries for "my-function"');
    t.expectResult(result).toContain("Processing request");
  });

  it("shows no logs message when empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", []);

    const result = await t.run("functions", "logs", "my-function");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No logs found");
  });

  it("filters by log level", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "info",
        message: "Info message",
      },
      {
        time: "2024-01-15T10:30:00.050Z",
        level: "error",
        message: "Error message",
      },
    ]);

    const result = await t.run(
      "functions",
      "logs",
      "my-function",
      "--level",
      "error"
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Showing 1 log entries");
    t.expectResult(result).toContain("Error message");
  });

  it("outputs raw JSON with --json flag", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      {
        time: "2024-01-15T10:30:00.000Z",
        level: "log",
        message: "Test message",
      },
    ]);

    const result = await t.run("functions", "logs", "my-function", "--json");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"time"');
    t.expectResult(result).toContain('"level"');
    t.expectResult(result).toContain('"message"');
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "logs", "my-function");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogsError("my-function", {
      status: 404,
      body: { error: "Function not found" },
    });

    const result = await t.run("functions", "logs", "my-function");

    t.expectResult(result).toFail();
  });

  it("fails with invalid level option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "functions",
      "logs",
      "my-function",
      "--level",
      "invalid"
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid level");
  });

  it("requires function name argument", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("functions", "logs");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("missing required argument");
  });
});
