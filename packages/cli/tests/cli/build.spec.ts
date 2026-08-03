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

describe("deploy --build", () => {
  const t = setupCLITests();

  const mockDeployApi = () => {
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockSiteDeploy({ app_url: "https://buildable.base44.app" });
  };

  it("builds before deploying when --build is passed", async () => {
    await t.givenLoggedInWithProject(fixture("with-buildable-site"));
    mockDeployApi();

    const result = await t.run("deploy", "--yes", "--build");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBe(
      `BUILD_APP=${t.api.appId}`,
    );
  });

  it("does not build when the build flag is absent in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("with-buildable-site"));
    mockDeployApi();

    const result = await t.run("deploy", "--yes");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBeNull();
  });

  it("does not build with --no-build", async () => {
    await t.givenLoggedInWithProject(fixture("with-buildable-site"));
    mockDeployApi();

    const result = await t.run("deploy", "--yes", "--no-build");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBeNull();
  });

  it("site deploy --build builds before uploading", async () => {
    await t.givenLoggedInWithProject(fixture("with-buildable-site"));
    t.api.mockSiteDeploy({ app_url: "https://buildable.base44.app" });

    const result = await t.run("site", "deploy", "--yes", "--build");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBe(
      `BUILD_APP=${t.api.appId}`,
    );
  });

  it("fails the deploy when the build fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-failing-build"));

    const result = await t.run("deploy", "--yes", "--build");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Build failed");
  });

  it("--build fails when the project has no site.buildCommand", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));

    const result = await t.run("deploy", "--yes", "--build");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No site build command found");
  });

  it("--build fails when the project has no site configuration", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const result = await t.run("deploy", "--yes", "--build");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No site build command found");
  });
});
