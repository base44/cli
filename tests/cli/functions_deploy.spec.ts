import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

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
    t.api.mockFunctionsPush({ deployed: ["process-order"], deleted: [], errors: null });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Functions deployed successfully");
    t.expectResult(result).toContain("Deployed: process-order");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockFunctionsPushError({ status: 400, body: { error: "Invalid function code" } });

    const result = await t.run("functions", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("400");
  });
});
