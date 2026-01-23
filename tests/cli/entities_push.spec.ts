import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("entities push command", () => {
  const { kit } = setupCLITests();

  it("warns when no entities found in project", async () => {
    // Given: user is logged in with a project that has no entities
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("basic"));

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: command succeeds but warns about no entities
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("No entities found in project");
  });

  it("fails when not in a project directory", async () => {
    // Given: user is logged in but not in a project directory
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    // Note: no givenProject() - running from temp dir with no project

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No Base44 project found");
  });

  it("finds and lists entities in project", async () => {
    // Given: project with entities
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-entities"));

    kit().api.setEntitiesPushResponse({
      created: ["User", "Product"],
      updated: [],
      deleted: [],
    });

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: it finds and lists the entities
    kit().expect(result).toContain("Found 2 entities to push");
    kit().expect(result).toContain("User");
    kit().expect(result).toContain("Product");
  });

  it("pushes entities successfully and shows results", async () => {
    // Given: logged in, project with entities, and mock API
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-entities"));

    kit().api.setEntitiesPushResponse({
      created: ["User"],
      updated: ["Product"],
      deleted: [],
    });

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: succeeds and shows created/updated entities
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Entities pushed successfully");
    kit().expect(result).toContain("Created: User");
    kit().expect(result).toContain("Updated: Product");
  });
});
