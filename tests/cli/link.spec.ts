import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("link command", () => {
  const t = setupCLITests();

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

  it("links project successfully with --create and --name flags", async () => {
    await t.givenLoggedInWithProject(fixture("no-app-config"));
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
      "A test application"
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
      "Description with short flag"
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Project linked");
  });
});
