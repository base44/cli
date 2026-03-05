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
    t.expectResult(result).toContain("1/1 deployed");
  });

  it("reports unchanged function", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeploy({ status: "unchanged" });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("unchanged");
    t.expectResult(result).toContain("1/1 deployed");
  });

  it("deploys specific function by name", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockSingleFunctionDeploy({ status: "deployed" });

    const result = await t.run("functions", "deploy", "process-order");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deploying process-order");
    t.expectResult(result).toContain("1/1 deployed");
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

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("error");
    t.expectResult(result).toContain("1 error");
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
