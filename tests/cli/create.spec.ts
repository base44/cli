import { describe, it } from "vitest";
import { join } from "node:path";
import { setupCLITests } from "./testkit/index.js";

describe("create command", () => {
  const { kit } = setupCLITests();

  // ─── NON-INTERACTIVE MODE ─────────────────────────────────────

  it("fails when --name is provided without --path", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run create with only --name
    const result = await kit().run("create", "--name", "my-project");

    // Then: command fails with validation error
    kit().expect(result).toFail();
    kit().expect(result).toContain("Non-interactive mode requires all flags");
  });

  it("fails when --path is provided without --name", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When: run create with only --path
    const result = await kit().run("create", "--path", "./my-project");

    // Then: command fails with validation error
    kit().expect(result).toFail();
    kit().expect(result).toContain("Non-interactive mode requires all flags");
  });

  it("creates project in non-interactive mode", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    kit().api.setCreateAppResponse({
      id: "new-project-id",
      name: "My New Project",
    });

    const projectPath = join(kit().getTempDir(), "my-new-project");

    // When: run create with --name and --path
    const result = await kit().run(
      "create",
      "--name", "My New Project",
      "--path", projectPath
    );

    // Then: command succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project created successfully");
    kit().expect(result).toContain("My New Project");
    kit().expect(result).toContain("new-project-id");
  });

  it("creates project with custom template", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    kit().api.setCreateAppResponse({
      id: "templated-project-id",
      name: "Templated Project",
    });

    const projectPath = join(kit().getTempDir(), "templated-project");

    // When: run create with --template flag
    const result = await kit().run(
      "create",
      "--name", "Templated Project",
      "--path", projectPath,
      "--template", "backend-only"
    );

    // Then: command succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project created successfully");
  });

  it("creates project with description", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({ email: "test@example.com", name: "Test User" });

    kit().api.setCreateAppResponse({
      id: "described-project-id",
      name: "Described Project",
    });

    const projectPath = join(kit().getTempDir(), "described-project");

    // When: run create with --description flag
    const result = await kit().run(
      "create",
      "--name", "Described Project",
      "--path", projectPath,
      "--description", "A test project with description"
    );

    // Then: command succeeds
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Project created successfully");
  });

  // ─── INTERACTIVE MODE ─────────────────────────────────────────
  // NOTE: Interactive mode tests are not possible with the current testing approach.
  // The CLI is bundled into dist/program.js, which means vi.doMock("@clack/prompts")
  // cannot intercept the bundled code. To test interactive mode, we would need to either:
  // 1. Test against source code (not what ships)
  // 2. Add injection points in the CLI for test mocking
  // 3. Use E2E testing with actual terminal input simulation
  //
  // For now, we rely on non-interactive mode tests (--name + --path flags) which
  // exercise the same createProjectFiles() and API logic.
});
