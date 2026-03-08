import { describe, it } from "vitest";
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
});
