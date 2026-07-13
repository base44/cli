import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

interface CapturedRequest {
  entityName: string;
  query: Record<string, unknown>;
  dataEnvHeader: string | undefined;
}

describe("data pull command", () => {
  const t = setupCLITests();

  /**
   * Mock GET /api/apps/:appId/entities/:entityName serving slices of
   * `records` per limit/skip (the runtime pagination contract), capturing
   * each request for assertions.
   */
  const mockEntityRecords = (
    recordsByEntity: Record<string, Record<string, unknown>[]>,
  ): CapturedRequest[] => {
    const captured: CapturedRequest[] = [];
    t.api.mockRoute(
      "GET",
      `/api/apps/${t.api.appId}/entities/:entityName`,
      (req, res) => {
        const entityName = req.params.entityName as string;
        captured.push({
          entityName,
          query: req.query as Record<string, unknown>,
          dataEnvHeader: req.headers["x-data-env"] as string | undefined,
        });
        const records = recordsByEntity[entityName] ?? [];
        const skip = Number.parseInt((req.query.skip as string) ?? "0", 10);
        const limit = Number.parseInt((req.query.limit as string) ?? "500", 10);
        res.json(records.slice(skip, skip + limit));
      },
    );
    return captured;
  };

  const makeRecords = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i + 1}`,
      company: `Company ${i + 1}`,
      created_by: "owner@example.com",
      created_date: "2026-01-01T00:00:00.000Z",
    }));

  it("pulls all project entities and writes fixtures with ids preserved", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    mockEntityRecords({
      Customer: makeRecords(2, "cust"),
      Product: [{ id: "prod-1", title: "Widget" }],
    });

    // When
    const result = await t.run("data", "pull", "--json");

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as {
      entities: Record<string, { pulled: number; total: number }>;
      wrote: string[];
    };
    expect(output.entities).toEqual({
      Customer: { pulled: 2, total: 2 },
      Product: { pulled: 1, total: 1 },
    });
    expect(output.wrote).toHaveLength(2);

    const customerFixture = JSON.parse(
      (await t.readProjectFile("base44/seed/customer.jsonc")) as string,
    ) as Record<string, unknown>[];
    expect(customerFixture).toHaveLength(2);
    expect(customerFixture[0]).toMatchObject({
      id: "cust-1",
      created_by: "owner@example.com",
      created_date: "2026-01-01T00:00:00.000Z",
    });
    expect(await t.fileExists("base44/seed/product.jsonc")).toBe(true);
  });

  it("paginates with limit/skip until the server runs out", async () => {
    // Given: 800 records = one full page of 500 + a short page of 300
    await t.givenLoggedInWithProject(fixture("with-entities"));
    const captured = mockEntityRecords({ Customer: makeRecords(800, "c") });

    // When
    const result = await t.run(
      "data",
      "pull",
      "--entity",
      "Customer",
      "--json",
    );

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as {
      entities: Record<string, { pulled: number }>;
    };
    expect(output.entities.Customer.pulled).toBe(800);
    expect(captured.map((r) => [r.query.limit, r.query.skip])).toEqual([
      ["500", "0"],
      ["500", "500"],
    ]);
  });

  it("stops at --limit", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    const captured = mockEntityRecords({ Customer: makeRecords(800, "c") });

    // When
    const result = await t.run(
      "data",
      "pull",
      "--entity",
      "Customer",
      "--limit",
      "600",
      "--json",
    );

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout) as {
      entities: Record<string, { pulled: number }>;
    };
    expect(output.entities.Customer.pulled).toBe(600);
    expect(captured.map((r) => [r.query.limit, r.query.skip])).toEqual([
      ["500", "0"],
      ["100", "500"],
    ]);
  });

  it("sends X-Data-Env only for --data-env dev", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    const captured = mockEntityRecords({ Customer: [], Product: [] });

    // When
    await t.run("data", "pull", "--data-env", "dev", "--json");
    const devRequests = captured.length;
    await t.run("data", "pull", "--json");

    // Then
    expect(devRequests).toBeGreaterThan(0);
    for (const request of captured.slice(0, devRequests)) {
      expect(request.dataEnvHeader).toBe("dev");
    }
    for (const request of captured.slice(devRequests)) {
      expect(request.dataEnvHeader).toBeUndefined();
    }
  });

  it("forwards --query as the q param", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    const captured = mockEntityRecords({ Customer: [] });

    // When
    const result = await t.run(
      "data",
      "pull",
      "--entity",
      "Customer",
      "--query",
      '{"company":"Acme"}',
      "--json",
    );

    // Then
    t.expectResult(result).toSucceed();
    expect(captured[0].query.q).toBe('{"company":"Acme"}');
  });

  it("rejects a --query that is not valid JSON", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));

    // When
    const result = await t.run(
      "data",
      "pull",
      "--query",
      "{not-json",
      "--json",
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--query must be valid JSON");
  });

  it("rejects an unknown --entity listing known names", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));

    // When
    const result = await t.run("data", "pull", "--entity", "Ghost");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain('Unknown entity "Ghost"');
    t.expectResult(result).toContain("Customer");
    t.expectResult(result).toContain("Product");
  });

  it("requires --force to overwrite existing fixtures when non-interactive", async () => {
    // Given: with-seed already has task.jsonc / team-member.jsonc fixtures
    await t.givenLoggedInWithProject(fixture("with-seed"));
    mockEntityRecords({ Task: [], TeamMember: [] });

    // When
    const withoutForce = await t.run("data", "pull");
    const withForce = await t.run("data", "pull", "--force");

    // Then
    t.expectResult(withoutForce).toFail();
    t.expectResult(withoutForce).toContain("--force");
    t.expectResult(withForce).toSucceed();
  });

  it("writes to --out instead of the seed dir", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    mockEntityRecords({ Customer: makeRecords(1, "c"), Product: [] });

    // When
    const result = await t.run("data", "pull", "--out", "exported", "--json");

    // Then
    t.expectResult(result).toSucceed();
    expect(await t.fileExists("exported/customer.jsonc")).toBe(true);
    expect(await t.fileExists("base44/seed/customer.jsonc")).toBe(false);
  });
});
