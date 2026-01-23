import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("deploy command (unified)", () => {
  const { kit } = setupCLITests();

  it("reports no resources when project is empty", async () => {
    // Given: logged in with a basic project (no entities, functions, or site)
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("basic"));

    // When: run deploy with -y to skip confirmation
    const result = await kit().run("deploy", "-y");

    // Then: command succeeds but reports no resources
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("No resources found to deploy");
  });

  it("fails when not in a project directory", async () => {
    // Given: user is logged in but not in a project directory
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run deploy
    const result = await kit().run("deploy", "-y");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No Base44 project found");
  });

  it("deploys entities successfully with -y flag", async () => {
    // Given: logged in, project with entities
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-entities"));

    kit().api.setEntitiesPushResponse({
      created: ["Customer", "Product"],
      updated: [],
      deleted: [],
    });

    // When: run deploy with -y
    const result = await kit().run("deploy", "-y");

    // Then: succeeds and shows deployment info
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Deployment completed");
    kit().expect(result).toContain("App deployed successfully");
  });

  it("deploys entities successfully with --yes flag", async () => {
    // Given: logged in, project with entities
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-entities"));

    kit().api.setEntitiesPushResponse({
      created: ["Customer", "Product"],
      updated: [],
      deleted: [],
    });

    // When: run deploy with --yes (long form)
    const result = await kit().run("deploy", "--yes");

    // Then: succeeds same as -y
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Deployment completed");
  });

  it("deploys entities and functions together", async () => {
    // Given: logged in, project with both entities and functions
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-functions-and-entities"));

    kit().api.setEntitiesPushResponse({
      created: ["Order"],
      updated: [],
      deleted: [],
    });
    kit().api.setFunctionsPushResponse({
      deployed: ["process-order"],
      deleted: [],
      errors: null,
    });

    // When: run deploy with -y
    const result = await kit().run("deploy", "-y");

    // Then: succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Deployment completed");
  });

  it("deploys entities, functions, and site together", async () => {
    // Given: logged in, project with entities, functions, and site
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("full-project"));

    kit().api.setEntitiesPushResponse({
      created: ["Task"],
      updated: [],
      deleted: [],
    });
    kit().api.setFunctionsPushResponse({
      deployed: ["hello"],
      deleted: [],
      errors: null,
    });
    kit().api.setSiteDeployResponse({
      app_url: "https://full-project.base44.app",
    });

    // When: run deploy with -y
    const result = await kit().run("deploy", "-y");

    // Then: succeeds and shows app URL
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Deployment completed");
    kit().expect(result).toContain("https://full-project.base44.app");
  });
});
