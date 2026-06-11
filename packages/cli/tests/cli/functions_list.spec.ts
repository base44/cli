import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("functions list command", () => {
  const t = setupCLITests();

  it("shows message when no functions deployed", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({ functions: [] });

    const result = await t.run("functions", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No functions on remote");
  });

  it("lists deployed functions", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "func-a",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "" }],
          automations: [],
        },
        {
          name: "func-b",
          deployment_id: "d2",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "" }],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("func-a");
    t.expectResult(result).toContain("func-b");
    t.expectResult(result).toContain("2 functions on remote");
  });

  it("shows automation count for functions with automations", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsList({
      functions: [
        {
          name: "func-a",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "" }],
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

    const result = await t.run("functions", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("func-a");
    t.expectResult(result).toContain("2 automations");
    t.expectResult(result).toContain("1 function on remote");
  });

  it("lists deployed functions with --app-id outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "projectless-func",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "" }],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "list", "--app-id", t.api.appId);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("projectless-func");
  });

  it("prefers --app-id over BASE44_APP_ID", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenEnv({ BASE44_APP_ID: "wrong-app-id" });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "flag-app-func",
          deployment_id: "d1",
          entry: "index.ts",
          files: [{ path: "index.ts", content: "" }],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "list", "--app-id", t.api.appId);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("flag-app-func");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "list");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockFunctionsListError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("functions", "list");

    t.expectResult(result).toFail();
  });
});
