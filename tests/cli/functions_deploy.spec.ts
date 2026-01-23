import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("functions deploy command", () => {
  const { kit } = setupCLITests();

  it("warns when no functions found in project", async () => {
    // Given: user is logged in with a project that has no functions
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("basic"));

    // When: run functions deploy
    const result = await kit().run("functions", "deploy");

    // Then: command succeeds but indicates no functions
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("No functions found");
  });

  it("fails when not in a project directory", async () => {
    // Given: user is logged in but not in a project directory
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run functions deploy
    const result = await kit().run("functions", "deploy");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No Base44 project found");
  });

  it("deploys functions successfully", async () => {
    // Given: logged in, project with functions
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-functions-and-entities"));

    kit().api.setFunctionsPushResponse({
      deployed: ["process-order"],
      deleted: [],
      errors: null,
    });

    // When: run functions deploy
    const result = await kit().run("functions", "deploy");

    // Then: succeeds and shows deployed function
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Functions deployed successfully");
    kit().expect(result).toContain("Deployed: process-order");
  });
});
