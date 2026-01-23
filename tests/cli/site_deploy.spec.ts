import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("site deploy command", () => {
  const { kit } = setupCLITests();

  it("fails when no site configuration found", async () => {
    // Given: logged in with a project that has no site config
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("basic"));

    // When: run site deploy with -y
    const result = await kit().run("site", "deploy", "-y");

    // Then: command fails with no site config error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No site configuration found");
  });

  it("fails when not in a project directory", async () => {
    // Given: user is logged in but not in a project directory
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run site deploy
    const result = await kit().run("site", "deploy", "-y");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No Base44 project found");
  });

  it("deploys site successfully", async () => {
    // Given: logged in with a project that has site config and dist folder
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("with-site"));

    kit().api.setSiteDeployResponse({
      app_url: "https://my-app.base44.app",
    });

    // When: run site deploy with -y
    const result = await kit().run("site", "deploy", "-y");

    // Then: command succeeds and shows app URL
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Site deployed successfully");
    kit().expect(result).toContain("https://my-app.base44.app");
  });
});
