import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const TEST_WORKSPACE_ID = "test-workspace-id";

describe("logs command", () => {
  const t = setupCLITests();

  it("fetches and displays audit logs successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogs(TEST_WORKSPACE_ID, {
      events: [
        {
          timestamp: "2024-01-15T10:30:00Z",
          user_email: "user@example.com",
          workspace_id: TEST_WORKSPACE_ID,
          app_id: "test-app-id",
          event_type: "api.function.call",
          status: "success",
          ip: null,
          user_agent: null,
          error_code: null,
          metadata: null,
        },
        {
          timestamp: "2024-01-15T10:29:00Z",
          user_email: "user@example.com",
          workspace_id: TEST_WORKSPACE_ID,
          app_id: "test-app-id",
          event_type: "app.entity.created",
          status: "failure",
          ip: null,
          user_agent: null,
          error_code: "VALIDATION_ERROR",
          metadata: { entity_name: "Task" },
        },
      ],
      pagination: {
        total: 2,
        limit: 50,
        has_more: false,
        next_cursor: null,
      },
    });

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logs fetched successfully");
    t.expectResult(result).toContain("Showing 2 of 2 events");
    t.expectResult(result).toContain("function unknown called");
    t.expectResult(result).toContain("failed to create entity Task");
  });

  it("shows no logs message when empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogs(TEST_WORKSPACE_ID, {
      events: [],
      pagination: {
        total: 0,
        limit: 50,
        has_more: false,
        next_cursor: null,
      },
    });

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No logs found matching the filters.");
  });

  it("outputs unified JSON with --json flag", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogs(TEST_WORKSPACE_ID, {
      events: [
        {
          timestamp: "2024-01-15T10:30:00Z",
          user_email: "user@example.com",
          workspace_id: TEST_WORKSPACE_ID,
          app_id: "test-app-id",
          event_type: "api.function.call",
          status: "success",
          ip: null,
          user_agent: null,
          error_code: null,
          metadata: null,
        },
      ],
      pagination: {
        total: 1,
        limit: 50,
        has_more: false,
        next_cursor: null,
      },
    });

    const result = await t.run("logs", "--json");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain('"time"');
    t.expectResult(result).toContain('"level"');
    t.expectResult(result).toContain('"message"');
    t.expectResult(result).toContain('"source"');
  });

  it("shows pagination hint when more results available", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogs(TEST_WORKSPACE_ID, {
      events: [
        {
          timestamp: "2024-01-15T10:30:00Z",
          user_email: "user@example.com",
          workspace_id: TEST_WORKSPACE_ID,
          app_id: "test-app-id",
          event_type: "api.function.call",
          status: "success",
          ip: null,
          user_agent: null,
          error_code: null,
          metadata: null,
        },
      ],
      pagination: {
        total: 100,
        limit: 50,
        has_more: true,
        next_cursor: {
          timestamp: "2024-01-15T10:29:00Z",
          user_email: "user@example.com",
        },
      },
    });

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("More results available");
    t.expectResult(result).toContain("--limit");
  });

  it("fetches only function logs when --function is specified", async () => {
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
    t.expectResult(result).toContain("Logs for \"my-function\" fetched");
    t.expectResult(result).toContain("Showing 2 log entries");
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

  it("filters function logs by --level", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionLogs("my-function", [
      { time: "2024-01-15T10:30:00.000Z", level: "info", message: "Info message" },
      { time: "2024-01-15T10:30:00.050Z", level: "error", message: "Error message" },
    ]);

    const result = await t.run("logs", "--function", "my-function", "--level", "error");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Error message");
    t.expectResult(result).toNotContain("Info message");
  });

  it("fetches both audit and function logs when no --function specified", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogs(TEST_WORKSPACE_ID, {
      events: [
        {
          timestamp: "2024-01-15T10:30:00Z",
          user_email: "user@example.com",
          workspace_id: TEST_WORKSPACE_ID,
          app_id: "test-app-id",
          event_type: "app.entity.created",
          status: "success",
          ip: null,
          user_agent: null,
          error_code: null,
          metadata: { entity_name: "Task", entity_id: "1" },
        },
      ],
      pagination: {
        total: 1,
        limit: 50,
        has_more: false,
        next_cursor: null,
      },
    });
    t.api.mockFunctionLogs("hello", [
      { time: "2024-01-15T10:29:00Z", level: "log", message: "Hello world" },
    ]);

    const result = await t.run("logs");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logs fetched successfully");
    t.expectResult(result).toContain("entity Task created");
    t.expectResult(result).toContain("Hello world");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("logs");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogsError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("logs");

    t.expectResult(result).toFail();
  });

  it("fails with invalid level option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    // --level is validated when fetching function logs; use --function so level is parsed
    t.api.mockFunctionLogs("dummy", []);

    const result = await t.run("logs", "--function", "dummy", "--level", "invalid");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid level");
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
    t.expectResult(result).toContain("Invalid order");
  });

  it("passes filter options to API", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppInfo({ organization_id: TEST_WORKSPACE_ID });
    t.api.mockAuditLogs(TEST_WORKSPACE_ID, {
      events: [],
      pagination: {
        total: 0,
        limit: 10,
        has_more: false,
        next_cursor: null,
      },
    });

    const result = await t.run("logs", "--limit", "10", "--order", "ASC");

    t.expectResult(result).toSucceed();
  });
});
