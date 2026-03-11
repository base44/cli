import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("site deploy command", () => {
  const t = setupCLITests();

  it("fails when no site configuration found", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No site configuration found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("deploys site successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockSiteDeploy({ app_url: "https://my-app.base44.app" });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Site deployed successfully");
    t.expectResult(result).toContain("https://my-app.base44.app");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockSiteDeployError({
      status: 413,
      body: { error: "Site too large" },
    });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toFail();
  });
});
