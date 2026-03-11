import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("functions pull command", () => {
  const t = setupCLITests();

  it("reports no functions when remote has none", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({ functions: [] });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No functions found on remote");
  });

  it("pulls functions successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "my-func",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "Deno.serve(() => {})" }],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Functions fetched successfully");
    t.expectResult(result).toContain("Function files written successfully");
    t.expectResult(result).toContain("Pulled 1 function");
  });

  it("pulls a single function by name", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "func-a",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "Deno.serve(() => {})" }],
          automations: [],
        },
        {
          name: "func-b",
          deployment_id: "d2",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "Deno.serve(() => {})" }],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "pull", "func-a");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Pulled 1 function");
  });

  it("reports function not found on remote", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({ functions: [] });

    const result = await t.run("functions", "pull", "nonexistent");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("not found on remote");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toFail();
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsListError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toFail();
  });

  it("pulls function with multiple files (imports)", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "with-imports",
          deployment_id: "d1",
          entry: "index.ts",
          files: [
            {
              path: "index.ts",
              content:
                'import { helper } from "./utils/helper.ts";\nDeno.serve(() => helper())',
            },
            {
              path: "utils/helper.ts",
              content: "export function helper() { return 'ok'; }",
            },
          ],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Pulled 1 function");
    const entry = await t.readProjectFile(
      "base44/functions/with-imports/index.ts",
    );
    expect(entry).toContain("import { helper }");
    const helper = await t.readProjectFile(
      "base44/functions/with-imports/utils/helper.ts",
    );
    expect(helper).toContain("export function helper");
  });

  it("pulls function with nested folder structure", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "nested-func",
          deployment_id: "d1",
          entry: "src/main.ts",
          files: [
            {
              path: "src/main.ts",
              content:
                'import { db } from "./lib/db.ts";\nDeno.serve(() => db())',
            },
            {
              path: "src/lib/db.ts",
              content: "export function db() { return 'connected'; }",
            },
            {
              path: "src/lib/types.ts",
              content: "export type Config = { key: string };",
            },
          ],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toSucceed();
    expect(await t.fileExists("base44/functions/nested-func/src/main.ts")).toBe(
      true,
    );
    expect(
      await t.fileExists("base44/functions/nested-func/src/lib/db.ts"),
    ).toBe(true);
    expect(
      await t.fileExists("base44/functions/nested-func/src/lib/types.ts"),
    ).toBe(true);
  });

  it("pulls function with automations", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "automated-func",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "Deno.serve(() => {})" }],
          automations: [
            {
              name: "daily-cron",
              type: "scheduled",
              schedule_mode: "recurring",
              schedule_type: "cron",
              cron_expression: "0 9 * * *",
              is_active: true,
            },
            {
              name: "on-order-create",
              type: "entity",
              entity_name: "orders",
              event_types: ["create", "update"],
              is_active: true,
            },
          ],
        },
      ],
    });

    const result = await t.run("functions", "pull");

    t.expectResult(result).toSucceed();
    const config = await t.readProjectFile(
      "base44/functions/automated-func/function.jsonc",
    );
    expect(config).toContain("automations");
    expect(config).toContain("daily-cron");
    expect(config).toContain("cron_expression");
    expect(config).toContain("on-order-create");
    expect(config).toContain("entity_name");
    expect(config).toContain("orders");
  });

  it("skips unchanged functions on second pull", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    const mockData = {
      functions: [
        {
          name: "stable-func",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "Deno.serve(() => {})" }],
          automations: [],
        },
      ],
    };

    // First pull — writes files
    t.api.mockFunctionsList(mockData);
    const first = await t.run("functions", "pull");
    t.expectResult(first).toSucceed();
    t.expectResult(first).toContain("written");

    // Second pull — should skip unchanged
    t.api.mockFunctionsList(mockData);
    const second = await t.run("functions", "pull");
    t.expectResult(second).toSucceed();
    t.expectResult(second).toContain("unchanged");
  });
});
