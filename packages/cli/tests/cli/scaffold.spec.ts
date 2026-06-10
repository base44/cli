import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const USER = { email: "test@example.com", name: "Test User" };

async function readTempFile(
  dir: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return await readFile(join(dir, relativePath), "utf-8");
  } catch {
    return null;
  }
}

describe("scaffold command", () => {
  const t = setupCLITests();

  it("scaffolds for an existing app id without creating a new app", async () => {
    await t.givenLoggedIn(USER);
    // Note: mockCreateApp is intentionally NOT registered. If scaffold tried
    // to create an app, the unmocked POST /api/apps would 404 and fail the run.

    const result = await t.run(
      "scaffold",
      "--app-id",
      "app-existing-123",
      "--no-skills",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project created successfully");
    t.expectResult(result).toContain("app-existing-123");

    const appConfig = await readTempFile(t.getTempDir(), "base44/.app.jsonc");
    expect(appConfig).toContain("app-existing-123");
  });

  it("reads the app id from BASE44_APP_ID when --app-id is omitted", async () => {
    await t.givenLoggedIn(USER);
    t.givenEnv({ BASE44_APP_ID: "app-from-env" });

    const result = await t.run("scaffold", "--no-skills");

    t.expectResult(result).toSucceed();
    const appConfig = await readTempFile(t.getTempDir(), "base44/.app.jsonc");
    expect(appConfig).toContain("app-from-env");
  });

  it("prefers --app-id over the BASE44_APP_ID env var", async () => {
    await t.givenLoggedIn(USER);
    t.givenEnv({ BASE44_APP_ID: "app-from-env" });

    const result = await t.run(
      "scaffold",
      "--app-id",
      "app-from-flag",
      "--no-skills",
    );

    t.expectResult(result).toSucceed();
    const appConfig = await readTempFile(t.getTempDir(), "base44/.app.jsonc");
    expect(appConfig).toContain("app-from-flag");
    expect(appConfig).not.toContain("app-from-env");
  });

  it("fails with a helpful message when no app id is available", async () => {
    await t.givenLoggedIn(USER);

    const result = await t.run("scaffold", "--no-skills");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No app ID found");
    t.expectResult(result).toContain("--app-id");
  });

  it("does not overwrite existing files when scaffolding", async () => {
    await t.givenLoggedIn(USER);

    // Pre-create base44/.gitignore (which the template would otherwise write).
    // This does not match the project-config pattern (base44/config.*), so
    // scaffold still proceeds, but the existing file must be preserved.
    const base44Dir = join(t.getTempDir(), "base44");
    await mkdir(base44Dir, { recursive: true });
    await writeFile(join(base44Dir, ".gitignore"), "# pre-existing\nkeep-me\n");

    const result = await t.run(
      "scaffold",
      "--app-id",
      "app-skip-existing",
      "--no-skills",
    );

    t.expectResult(result).toSucceed();

    const gitignore = await readTempFile(t.getTempDir(), "base44/.gitignore");
    expect(gitignore).toContain("keep-me");
  });
});
