import { join } from "node:path";
import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("create command", () => {
  const t = setupCLITests();

  // ─── NON-INTERACTIVE MODE ─────────────────────────────────────

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
});
