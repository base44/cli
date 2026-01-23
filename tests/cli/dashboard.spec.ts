import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("dashboard command", () => {
  const { kit } = setupCLITests();

  it("opens dashboard with correct URL when logged in", async () => {
    // Given: user is logged in with a project
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("basic"));

    // When: run dashboard command
    const result = await kit().run("dashboard");

    // Then: command succeeds and shows the dashboard URL
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Dashboard opened at");
    kit().expect(result).toContain("test-app-id");
  });

  it("fails when not in a project directory", async () => {
    // Given: user is logged in but not in a project directory
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run dashboard command
    const result = await kit().run("dashboard");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No Base44 project found");
  });
});
