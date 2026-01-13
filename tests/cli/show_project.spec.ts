import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("show-project command", () => {
  const { kit } = setupCLITests();

  it("displays project configuration with entities", async () => {
    // Given: project with entities
    await kit().givenProject(fixture("with-entities"));

    // When: run show-project command
    const result = await kit().run("show-project");

    // Then: displays project info including entities
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Entities Test Project");
    kit().expect(result).toContain("User");
    kit().expect(result).toContain("Product");
  });

  it("displays project configuration with functions", async () => {
    // Given: project with functions and entities
    await kit().givenProject(fixture("with-functions-and-entities"));

    // When: run show-project command
    const result = await kit().run("show-project");

    // Then: displays project info including functions
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Order");
    kit().expect(result).toContain("process-order");
  });

  it("fails when not in a project directory", async () => {
    // Given: no project directory (running from temp dir)

    // When: run show-project command
    const result = await kit().run("show-project");

    // Then: fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("Project root not found");
  });

  it("fails with invalid project config", async () => {
    // Given: project with invalid config schema
    await kit().givenProject(fixture("invalid-config-schema"));

    // When: run show-project command
    const result = await kit().run("show-project");

    // Then: fails with validation error
    kit().expect(result).toFail();
    kit().expect(result).toContain("Invalid project configuration");
  });
});
