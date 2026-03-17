import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSON5 from "json5";
import { create as tarCreate } from "tar";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

/**
 * Creates a tar.gz buffer from a fixture directory.
 * Uses the same pattern as src/core/site/deploy.ts - writes to temp file then reads it.
 */
async function createTarFromFixture(fixturePath: string): Promise<Buffer> {
  const archivePath = join(tmpdir(), `test-fixture-${Date.now()}.tar.gz`);

  try {
    await tarCreate(
      {
        gzip: true,
        file: archivePath,
        cwd: fixturePath,
      },
      ["."],
    );
    return await readFile(archivePath);
  } finally {
    await unlink(archivePath).catch(() => {});
  }
}

describe("eject command", () => {
  const t = setupCLITests();

  it("fails when project ID not found", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListProjects([
      {
        id: "other-project",
        name: "Other Project",
        is_managed_source_code: true,
      },
    ]);

    const result = await t.run(
      "eject",
      "--project-id",
      "non-existent-id",
      "-p",
      "./out",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found or not ejectable");
  });

  it("fails when project is not ejectable (is_managed_source_code=false)", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockListProjects([
      {
        id: "test-app-id",
        name: "Test Project",
        is_managed_source_code: false,
      },
    ]);

    const result = await t.run(
      "eject",
      "--project-id",
      "test-app-id",
      "-p",
      "./out",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found or not ejectable");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("eject", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(
      "Download the code for an existing Base44 project",
    );
    t.expectResult(result).toContain("--project-id");
    t.expectResult(result).toContain("-p, --path");
  });

  it("ejects project and creates files successfully", async () => {
    // Given: logged in user, a project to eject, and tar content from fixture
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const tarContent = await createTarFromFixture(fixture("with-entities"));

    t.api.mockListProjects([
      {
        id: "test-app-id",
        name: "My Test Project",
        user_description: "A test project",
        is_managed_source_code: true,
      },
    ]);
    t.api.mockProjectEject(new Uint8Array(tarContent));
    t.api.mockCreateApp({ id: "new-project-id", name: "My Test Project Copy" });

    // When: running eject with project-id, path, and -y to skip prompts
    const outputPath = join(t.getTempDir(), "ejected-project");
    const result = await t.run(
      "eject",
      "--project-id",
      "test-app-id",
      "-p",
      outputPath,
      "-y",
    );

    // Then: command succeeds and files are created
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project pulled successfully");

    // Verify the app config was created with the new project ID
    const appConfigContent = await readFile(
      join(outputPath, "base44/.app.jsonc"),
      "utf-8",
    );
    const appConfig = JSON5.parse(appConfigContent);
    expect(appConfig.id).toBe("new-project-id");
  });
});
