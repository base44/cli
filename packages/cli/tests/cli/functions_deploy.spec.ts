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
    t.api.mockSingleFunctionDeploy({ status: "deployed" });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deploying process-order");
    t.expectResult(result).toContain("deployed");
    t.expectResult(result).toContain("1 deployed");
  });

  it("reports unchanged function", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeploy({ status: "unchanged" });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("unchanged");
    t.expectResult(result).toContain("1 unchanged");
  });

  it("deploys zero-config and path-named functions successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-zero-config-functions"));
    t.api.mockSingleFunctionDeploy({ status: "deployed" });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("foo/bar");
    t.expectResult(result).toContain("foo/kfir/hello");
    t.expectResult(result).toContain("custom-name");
    t.expectResult(result).toContain("stam");
  });

  it("does not collect zero-config functions whose path contains a dot", async () => {
    await t.givenLoggedInWithProject(fixture("with-zero-config-functions"));
    t.api.mockSingleFunctionDeploy({ status: "deployed" });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toNotContain("all.products");
    t.expectResult(result).toNotContain("getProducts/all.products");
  });

  it("deploys specific function by name", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeploy({ status: "deployed" });

    const result = await t.run("functions", "deploy", "process-order");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deploying process-order");
    t.expectResult(result).toContain("1 deployed");
  });

  it("fails when function name not found in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));

    const result = await t.run("functions", "deploy", "nonexistent");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found in project");
  });

  it("reports error when API fails for a function", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeployError({
      status: 400,
      body: { error: "Invalid function code" },
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("error");
    t.expectResult(result).toContain("1 error");
    t.expectResult(result).toContain("1 function failed to deploy");
  });

  it("reports validation error from 422 response", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeployError({
      status: 422,
      body: {
        message: "Minimum interval for minute-based schedules is 5 minutes.",
      },
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("error");
    t.expectResult(result).toContain(
      "Minimum interval for minute-based schedules is 5 minutes.",
    );
    t.expectResult(result).toContain("1 function failed to deploy");
  });

  it("reports too-many-functions error from 422 response", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeployError({
      status: 422,
      body: {
        message: "Maximum of 50 functions per app reached.",
      },
    });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("error");
    t.expectResult(result).toContain(
      "Maximum of 50 functions per app reached.",
    );
    t.expectResult(result).toContain("1 function failed to deploy");
  });

  it("prunes remote functions missing locally with --force", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeploy({ status: "deployed" });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "stale-function",
          deployment_id: "dep_123",
          entry: "index.ts",
          files: [],
          automations: [],
        },
      ],
    });
    t.api.mockSingleFunctionDelete();

    const result = await t.run("functions", "deploy", "--force");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 1 remote function to delete");
    t.expectResult(result).toContain("stale-function");
    t.expectResult(result).toContain("deleted");
    t.expectResult(result).toContain("1 deleted");
  });

  it("does not prune remote functions when deploy fails with --force", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeployError({
      status: 400,
      body: { error: "Invalid function code" },
    });
    t.api.mockFunctionsList({
      functions: [
        {
          name: "stale-function",
          deployment_id: "dep_123",
          entry: "index.ts",
          files: [],
          automations: [],
        },
      ],
    });
    t.api.mockSingleFunctionDelete();

    const result = await t.run("functions", "deploy", "--force");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("1 function failed to deploy");
    t.expectResult(result).toNotContain("Found 1 remote function to delete");
    t.expectResult(result).toNotContain("stale-function");
  });

  it("rejects --force with specific function names", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));

    const result = await t.run(
      "functions",
      "deploy",
      "process-order",
      "--force",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--force cannot be used when specifying function names",
    );
  });
});
