import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("functions deploy command", () => {
  const t = setupCLITests();

  it("warns when no functions found in project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No functions found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("deploys functions successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPush({
      deployed: ["process-order"],
      deleted: [],
      errors: null,
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Functions deployed successfully");
    t.expectResult(result).toContain("Deployed: process-order");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPushError({
      status: 400,
      body: { error: "Invalid function code" },
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid function code");
  });

  it("shows per-function errors from successful response with errors array", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPush({
      deployed: [],
      deleted: [],
      errors: [{ name: "process-order", message: "Syntax error on line 42" }],
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "'process-order': Syntax error on line 42",
    );
    t.expectResult(result).toContain(
      "Check the function code for syntax errors",
    );
  });

  it("shows validation errors from 422 response with extra_data.errors", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPushError({
      status: 422,
      body: {
        message: "Validation failed",
        detail: null,
        extra_data: {
          errors: [
            {
              name: "myFunc",
              message:
                "Minimum interval for minute-based schedules is 5 minutes.",
            },
          ],
        },
      },
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Validation failed");
    t.expectResult(result).toContain("myFunc");
    t.expectResult(result).toContain(
      "Minimum interval for minute-based schedules is 5 minutes.",
    );
  });

  it("shows too-many-functions error from 422 response", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPushError({
      status: 422,
      body: {
        message: "Too many functions. Maximum is 50, got 51.",
        detail: null,
      },
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "Too many functions. Maximum is 50, got 51.",
    );
    t.expectResult(result).toContain("validation error");
  });

  it("shows deployed and deleted functions together", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPush({
      deployed: ["process-order"],
      deleted: ["old-handler"],
      errors: null,
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployed: process-order");
    t.expectResult(result).toContain("Deleted: old-handler");
  });
});
