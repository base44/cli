import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const TEST_WORKSPACE_ID = "test-workspace-id";

describe("logs command", () => {
  const t = setupCLITests();

  it("fetches and displays logs successfully", async () => {
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
    t.expectResult(result).toContain("api.function.call");
    t.expectResult(result).toContain("app.entity.created");
  });

  it("shows no events message when empty", async () => {
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
    t.expectResult(result).toContain("No events found");
  });

  it("outputs raw JSON with --json flag", async () => {
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
    t.expectResult(result).toContain('"events"');
    t.expectResult(result).toContain('"pagination"');
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
    t.expectResult(result).toContain("--cursor-timestamp");
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

  it("fails with invalid status option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("logs", "--status", "invalid");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid status");
  });

  it("fails with invalid event-types option", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("logs", "--event-types", "not-json");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid event-types");
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

    const result = await t.run(
      "logs",
      "--status",
      "failure",
      "--limit",
      "10",
      "--order",
      "ASC"
    );

    t.expectResult(result).toSucceed();
  });
});
