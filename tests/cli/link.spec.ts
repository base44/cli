import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("link command", () => {
  const { kit } = setupCLITests();

  it("fails when not in a project directory", async () => {
    // Given: user is logged in but not in a project directory
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run link command
    const result = await kit().run("link", "--create", "--name", "test-app");

    // Then: command fails with project not found error
    kit().expect(result).toFail();
    kit().expect(result).toContain("No Base44 project found");
  });

  it("fails when project is already linked", async () => {
    // Given: logged in with a project that already has .app.jsonc
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("basic"));

    // When: run link command
    const result = await kit().run("link", "--create", "--name", "test-app");

    // Then: command fails because project is already linked
    kit().expect(result).toFail();
    kit().expect(result).toContain("already linked");
  });

  it("fails when --create is used without --name", async () => {
    // Given: logged in with unlinked project
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("no-app-config"));

    // When: run link with --create but no --name
    const result = await kit().run("link", "--create");

    // Then: command fails with validation error
    kit().expect(result).toFail();
    kit().expect(result).toContain("--name is required");
  });

  it("links project successfully with --create and --name flags", async () => {
    // Given: logged in with unlinked project
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("no-app-config"));

    kit().api.setCreateAppResponse({
      id: "new-created-app-id",
      name: "My New App",
    });

    // When: run link with --create and --name
    const result = await kit().run("link", "--create", "--name", "My New App");

    // Then: command succeeds and shows dashboard URL
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project linked");
    kit().expect(result).toContain("Dashboard");
    kit().expect(result).toContain("new-created-app-id");
  });

  it("links project with --description flag", async () => {
    // Given: logged in with unlinked project
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("no-app-config"));

    kit().api.setCreateAppResponse({
      id: "app-with-desc",
      name: "App With Description",
    });

    // When: run link with all flags
    const result = await kit().run(
      "link",
      "--create",
      "--name", "App With Description",
      "--description", "A test application"
    );

    // Then: command succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project linked");
  });

  it("accepts short flag -c for --create", async () => {
    // Given: logged in with unlinked project
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("no-app-config"));

    kit().api.setCreateAppResponse({
      id: "short-flag-app",
      name: "Short Flag App",
    });

    // When: run link with -c short flag
    const result = await kit().run("link", "-c", "--name", "Short Flag App");

    // Then: command succeeds same as --create
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project linked");
  });

  it("accepts short flags -n for --name and -d for --description", async () => {
    // Given: logged in with unlinked project
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await kit().givenProject(fixture("no-app-config"));

    kit().api.setCreateAppResponse({
      id: "all-short-flags-app",
      name: "All Short Flags",
    });

    // When: run link with all short flags
    const result = await kit().run(
      "link",
      "-c",
      "-n", "All Short Flags",
      "-d", "Description with short flag"
    );

    // Then: command succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project linked");
  });
});
