import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

/** The fullstack fixture is not a git repo, so these deploys pass --git-hash. */
const GIT_HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const DEPLOYMENT_ID = "test-app-git-a1b2c3d4e5f6";
const SESSION_ID = "3f9a1c07b8e44d2f";

describe("site deploy command", () => {
  const t = setupCLITests();

  it("fails when --yes is not provided in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));

    const result = await t.run("site", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--yes is required in non-interactive mode",
    );
  });

  it("deploys from the default output directory when no site configuration found", async () => {
    // Nothing is built in the fixture, so ./dist is missing and the deploy fails there.
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("using the default site commands");
    t.expectResult(result).toContain("dist");
    t.expectResult(result).toNotContain("No site configuration found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("deploys site successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(`Deployment ${DEPLOYMENT_ID}`);
  });

  it("deploys without publishing, so the platform's build step is unaffected", async () => {
    // The platform builds a builder-managed app with this command and repoints
    // production itself; publishing here would fail that app outright.
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });
    t.api.mockDeploymentPublish();

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Run again with --publish");
    expect(t.api.publishedCommits).toEqual([]);
  });

  it("falls back to the archive upload, which goes live, when the build has no commit", async () => {
    // The fixture is not a git checkout, so there is no address to deploy to.
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockSiteDeploy({ app_url: "https://with-site.base44.app" });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No commit found for this build");
    t.expectResult(result).toContain("https://with-site.base44.app");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("--publish serves the deployed commit", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });
    t.api.mockDeploymentPublish({ app_url: "https://my-app.base44.app" });

    const result = await t.run(
      "site",
      "deploy",
      "-y",
      "--git-hash",
      GIT_HASH,
      "--publish",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("https://my-app.base44.app");
    expect(t.api.publishedCommits).toEqual([GIT_HASH]);
  });

  it("deploys the Workers build for a full-stack project", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Site deployed");
    t.expectResult(result).toContain(DEPLOYMENT_ID);
  });

  it("prefers the Workers build over the configured output directory", async () => {
    // A full-stack artifact carries the server too, so deploying the static
    // output directory instead would silently drop the worker.
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    await writeFile(
      join(t.getTempDir(), "project", "base44", "config.jsonc"),
      JSON.stringify({
        name: "Fullstack Project",
        site: { outputDirectory: "build/client" },
      }),
    );
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(DEPLOYMENT_ID);
    // The worker's config is what makes the server store the assets on
    // Cloudflare; a static create would carry none.
    expect(
      (t.api.deploymentCreateRequests[0] as { config?: unknown }).config,
    ).toBeDefined();
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockDeploymentCreateError({
      status: 413,
      body: { error: "Site too large" },
    });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toFail();
  });
});
