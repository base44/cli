import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const SAMPLE_RECORD = {
  id: "rec-123",
  name: "John Doe",
  email: "john@example.com",
  created_date: "2025-01-01T00:00:00Z",
  updated_date: "2025-01-02T00:00:00Z",
  created_by: "admin@example.com",
};

const SAMPLE_RECORD_2 = {
  id: "rec-456",
  name: "Jane Smith",
  email: "jane@example.com",
  created_date: "2025-01-03T00:00:00Z",
  updated_date: "2025-01-04T00:00:00Z",
  created_by: "admin@example.com",
};

describe("entities records list command", () => {
  const t = setupCLITests();

  it("lists records successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordsList("Customer", [SAMPLE_RECORD, SAMPLE_RECORD_2]);

    const result = await t.run("entities", "records", "list", "Customer");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 2 record(s)");
    t.expectResult(result).toContainInStdout("rec-123");
    t.expectResult(result).toContainInStdout("rec-456");
  });

  it("lists records with empty result", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordsList("Customer", []);

    const result = await t.run("entities", "records", "list", "Customer");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 0 record(s)");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordsListError("Customer", {
      status: 404,
      body: { message: "Entity schema Customer not found in app" },
    });

    const result = await t.run("entities", "records", "list", "Customer");

    t.expectResult(result).toFail();
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("entities", "records", "list", "Customer");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });
});

describe("entities records get command", () => {
  const t = setupCLITests();

  it("gets a single record by ID", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordGet("Customer", "rec-123", SAMPLE_RECORD);

    const result = await t.run(
      "entities",
      "records",
      "get",
      "Customer",
      "rec-123",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContainInStdout("rec-123");
    t.expectResult(result).toContainInStdout("John Doe");
  });

  it("fails when record not found", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordGetError("Customer", "nonexistent", {
      status: 404,
      body: { message: "Entity Customer with ID nonexistent not found" },
    });

    const result = await t.run(
      "entities",
      "records",
      "get",
      "Customer",
      "nonexistent",
    );

    t.expectResult(result).toFail();
  });
});

describe("entities records create command", () => {
  const t = setupCLITests();

  it("creates a record with --data flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordCreate("Customer", SAMPLE_RECORD);

    const result = await t.run(
      "entities",
      "records",
      "create",
      "Customer",
      "--data",
      '{"name": "John Doe", "email": "john@example.com"}',
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Record created with ID: rec-123");
    t.expectResult(result).toContainInStdout("rec-123");
  });

  it("fails with invalid JSON in --data", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const result = await t.run(
      "entities",
      "records",
      "create",
      "Customer",
      "--data",
      "{invalid json}",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid JSON");
  });

  it("fails when neither --data nor --file provided", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const result = await t.run("entities", "records", "create", "Customer");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Provide record data");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordCreateError("Customer", {
      status: 400,
      body: { message: "Validation failed" },
    });

    const result = await t.run(
      "entities",
      "records",
      "create",
      "Customer",
      "--data",
      '{"name": "John"}',
    );

    t.expectResult(result).toFail();
  });
});

describe("entities records update command", () => {
  const t = setupCLITests();

  it("updates a record with --data flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordUpdate("Customer", "rec-123", {
      ...SAMPLE_RECORD,
      name: "John Updated",
    });

    const result = await t.run(
      "entities",
      "records",
      "update",
      "Customer",
      "rec-123",
      "--data",
      '{"name": "John Updated"}',
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Record rec-123 updated");
    t.expectResult(result).toContainInStdout("John Updated");
  });

  it("fails with invalid JSON in --data", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const result = await t.run(
      "entities",
      "records",
      "update",
      "Customer",
      "rec-123",
      "--data",
      "not json",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid JSON");
  });

  it("fails when record not found", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordUpdateError("Customer", "nonexistent", {
      status: 404,
      body: { message: "Entity Customer with ID nonexistent not found" },
    });

    const result = await t.run(
      "entities",
      "records",
      "update",
      "Customer",
      "nonexistent",
      "--data",
      '{"name": "test"}',
    );

    t.expectResult(result).toFail();
  });
});

describe("entities records delete command", () => {
  const t = setupCLITests();

  it("deletes a record with --yes flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordDelete("Customer", "rec-123");

    const result = await t.run(
      "entities",
      "records",
      "delete",
      "Customer",
      "rec-123",
      "--yes",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Record rec-123 deleted");
  });

  it("fails when record not found", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordDeleteError("Customer", "nonexistent", {
      status: 404,
      body: { message: "Entity Customer with ID nonexistent not found" },
    });

    const result = await t.run(
      "entities",
      "records",
      "delete",
      "Customer",
      "nonexistent",
      "--yes",
    );

    t.expectResult(result).toFail();
  });

  it("fails when API returns permission error", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockRecordDeleteError("Customer", "rec-123", {
      status: 403,
      body: { message: "Permission denied" },
    });

    const result = await t.run(
      "entities",
      "records",
      "delete",
      "Customer",
      "rec-123",
      "--yes",
    );

    t.expectResult(result).toFail();
  });
});
