import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("entities push command", () => {
  const { kit } = setupCLITests();

  it("warns when no entities found in project", async () => {
    // Given: user is logged in with a project that has no entities
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    kit().givenEnv("BASE44_CLIENT_ID", "test-app-id");
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
    kit().givenEnv("BASE44_CLIENT_ID", "test-app-id");
    // Note: no givenProject() - running from temp dir with no project

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("Project root not found");
  });

  it("fails when BASE44_CLIENT_ID is not set", async () => {
    // Given: user is logged in but no CLIENT_ID
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-entities"));
    // Note: BASE44_CLIENT_ID is NOT set

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: command fails with CLIENT_ID error
    kit().expect(result).toFail();
    kit().expect(result).toContain("BASE44_CLIENT_ID");
  });

  it("finds and lists entities in project", async () => {
    // Given: project with entities but missing CLIENT_ID (so it fails before HTTP)
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-entities"));
    // No CLIENT_ID, so it will fail but after counting entities

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: it finds and lists the entities before failing
    kit().expect(result).toContain("Found 2 entities to push");
    kit().expect(result).toContain("User");
    kit().expect(result).toContain("Product");
  });

  it("pushes entities successfully and shows results", async () => {
    // Given: logged in, project with entities, and mock API
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    kit().givenEnv("BASE44_CLIENT_ID", "test-app-123");
    await kit().givenProject(fixture("with-entities"));

    kit().givenRoute("PUT", "/api/apps/:appId/entities-schemas/sync-all", () => ({
      body: {
        created: ["User"],
        updated: ["Product"],
        deleted: [],
      },
    }));

    // When: run entities push
    const result = await kit().run("entities", "push");

    // Then: succeeds and shows created/updated entities
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Entities pushed successfully");
    kit().expect(result).toContain("Created: User");
    kit().expect(result).toContain("Updated: Product");
  });
});
