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

  it("does not prune remote functions with --force when a function fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeployError({
      status: 400,
      body: { error: "Invalid function code" },
    });
    // If prune ran, it would call this endpoint and surface "orphan-fn" in the
    // output via the "Found N remote functions to delete" log line.
    t.api.mockFunctionsList({
      functions: [
        {
          name: "orphan-fn",
          deployment_id: "dep_orphan",
          entry: "index.ts",
          files: [],
          automations: [],
        },
      ],
    });

    const result = await t.run("functions", "deploy", "--force");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("1 error");
    t.expectResult(result).toNotContain("orphan-fn");
  });
});
