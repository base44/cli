import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("functions delete command", () => {
  const t = setupCLITests();

  it("deletes a single function successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleFunctionDelete();

    const result = await t.run("functions", "delete", "my-func");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("deleted");
  });

  it("deletes multiple functions with summary", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleFunctionDelete();

    const result = await t.run("functions", "delete", "func-a", "func-b");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("func-a deleted");
    t.expectResult(result).toContain("func-b deleted");
    t.expectResult(result).toContain("2/2 deleted");
  });

  it("reports not found for non-existent function", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleFunctionDeleteError({
      status: 404,
      body: { error: "Not found" },
    });

    const result = await t.run("functions", "delete", "nonexistent");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("not found");
  });

  it("reports API errors gracefully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSingleFunctionDeleteError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("functions", "delete", "my-func");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Failed to delete");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "delete", "my-func");

    t.expectResult(result).toFail();
  });
});
