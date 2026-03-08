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
            { name: "auto1", type: "scheduled", is_active: true },
          ],
        },
      ],
    });

    const result = await t.run("functions", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("func-a");
    t.expectResult(result).toContain("1 automation");
    t.expectResult(result).toContain("1 function on remote");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "list");

    t.expectResult(result).toFail();
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
