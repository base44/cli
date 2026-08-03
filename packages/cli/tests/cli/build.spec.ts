import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("build command", () => {
  const t = setupCLITests();

  it("runs the site buildCommand with the app id injected", async () => {
    await t.givenLoggedInWithProject(fixture("with-buildable-site"));

    const result = await t.run("build");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBe(
      `BUILD_APP=${t.api.appId}`,
    );
  });

  it("fails when the project has no site.buildCommand", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));

    const result = await t.run("build");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No site build command found");
  });

  it("fails when the buildCommand fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-failing-build"));

    const result = await t.run("build");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Build failed");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("build");

    t.expectResult(result).toFail();
  });
});
