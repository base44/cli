import { join } from "node:path";
import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("create command", () => {
  const t = setupCLITests();

  // ─── NON-INTERACTIVE MODE ─────────────────────────────────────

  it("fails when name and path are missing in non-interactive mode", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockCreateApp({ id: "app-123", name: "test" });

    const result = await t.run("create");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("required in non-interactive mode");
  });

  it("fails when --path is provided without name argument", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("create", "--path", "./my-project");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--path requires a project name argument");
  });

  it("creates project in non-interactive mode", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockCreateApp({ id: "new-project-id", name: "My New Project" });

    const projectPath = join(t.getTempDir(), "my-new-project");

    const result = await t.run(
      "create",
      "My New Project",
      "--path",
      projectPath,
      "--no-skills",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project created successfully");
    t.expectResult(result).toContain("My New Project");
    t.expectResult(result).toContain("new-project-id");
  });

  it("infers path from name when --path is not provided", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockCreateApp({ id: "inferred-path-id", name: "My App" });

    const result = await t.run("create", "My App", "--no-skills");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Creating a new project at");
    t.expectResult(result).toContain("Project created successfully");
  });

  it("creates project with custom template", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockCreateApp({
      id: "templated-project-id",
      name: "Templated Project",
    });

    const projectPath = join(t.getTempDir(), "templated-project");

    const result = await t.run(
      "create",
      "Templated Project",
      "--path",
      projectPath,
      "--template",
      "backend-only",
      "--no-skills",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project created successfully");
  });

  it("refuses to create when BASE44_APP_ID is set, pointing to scaffold", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenEnv({ BASE44_APP_ID: "app-existing-123" });
    // mockCreateApp intentionally NOT registered: the guard must stop before any
    // create-app API call.

    const result = await t.run(
      "create",
      "My App",
      "--path",
      join(t.getTempDir(), "my-app"),
      "--no-skills",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("BASE44_APP_ID");
    t.expectResult(result).toContain("scaffold");
    t.expectResult(result).toContain("--force");
  });

  it("creates a new app with --force even when BASE44_APP_ID is set", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenEnv({ BASE44_APP_ID: "app-existing-123" });
    t.api.mockCreateApp({ id: "brand-new-id", name: "My App" });

    const result = await t.run(
      "create",
      "My App",
      "--path",
      join(t.getTempDir(), "my-app"),
      "--no-skills",
      "--force",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project created successfully");
    t.expectResult(result).toContain("brand-new-id");
  });
});
