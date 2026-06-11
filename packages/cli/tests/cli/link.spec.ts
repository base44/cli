import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("link command", () => {
  const t = setupCLITests();

  it("fails when neither --create nor --app-id in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));

    const result = await t.run("link");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("required in non-interactive mode");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("link", "--create", "--name", "test-app");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails when project is already linked", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("link", "--create", "--name", "test-app");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("already linked");
  });

  it("fails when --create is used without --name", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));

    const result = await t.run("link", "--create");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--name is required");
  });

  it("links an existing app with --app-id", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.api.mockListProjects([
      {
        id: "existing-app-id",
        name: "Existing App",
        is_managed_source_code: false,
      },
    ]);

    const result = await t.run("link", "--app-id", "existing-app-id");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
    t.expectResult(result).toContain("existing-app-id");

    const appConfig = await readFile(
      join(t.getTempDir(), "project", "base44", ".app.jsonc"),
      "utf-8",
    );
    expect(appConfig).toContain("existing-app-id");
  });

  it("links an existing app with legacy --project-id", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.api.mockListProjects([
      {
        id: "legacy-app-id",
        name: "Legacy App",
        is_managed_source_code: false,
      },
    ]);

    const result = await t.run("link", "--project-id", "legacy-app-id");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
    t.expectResult(result).toContain("legacy-app-id");
  });

  it("links an existing app with legacy --projectId", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.api.mockListProjects([
      {
        id: "camel-legacy-app-id",
        name: "Camel Legacy App",
        is_managed_source_code: false,
      },
    ]);

    const result = await t.run("link", "--projectId", "camel-legacy-app-id");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
    t.expectResult(result).toContain("camel-legacy-app-id");
  });

  it("fails when --app-id and legacy --project-id are used together", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));

    const result = await t.run(
      "link",
      "--app-id",
      "existing-app-id",
      "--project-id",
      "legacy-app-id",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--app-id and --project-id cannot be used together",
    );
  });

  it("does not show legacy --project-id in help", async () => {
    const result = await t.run("link", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("--app-id");
    t.expectResult(result).toNotContain("--project-id");
    t.expectResult(result).toNotContain("--projectId");
  });

  it("fails when --create and --app-id are used together", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));

    const result = await t.run(
      "link",
      "--create",
      "--name",
      "test-app",
      "--app-id",
      "existing-app-id",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--create and --app-id cannot be used together",
    );
  });

  it("links project successfully with --create and --name flags", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.givenEnv({ BASE44_APP_ID: "ambient-app-id" });
    t.api.mockCreateApp({ id: "new-created-app-id", name: "My New App" });

    const result = await t.run("link", "--create", "--name", "My New App");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
    t.expectResult(result).toContain("Dashboard");
    t.expectResult(result).toContain("new-created-app-id");
  });

  it("links project with --description flag", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.api.mockCreateApp({ id: "app-with-desc", name: "App With Description" });

    const result = await t.run(
      "link",
      "--create",
      "--name",
      "App With Description",
      "--description",
      "A test application",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
  });

  it("accepts short flag -c for --create", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.api.mockCreateApp({ id: "short-flag-app", name: "Short Flag App" });

    const result = await t.run("link", "-c", "--name", "Short Flag App");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
  });

  it("accepts short flags -n for --name and -d for --description", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
    t.api.mockCreateApp({ id: "all-short-flags-app", name: "All Short Flags" });

    const result = await t.run(
      "link",
      "-c",
      "-n",
      "All Short Flags",
      "-d",
      "Description with short flag",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
  });
});
