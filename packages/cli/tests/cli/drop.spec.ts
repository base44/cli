import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP_URL = "https://my-site.base44.app";

describe("drop command", () => {
  const t = setupCLITests();

  it("creates an app named after the folder and deploys it", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await t.givenUnlinkedProject(fixture("static-drop"));
    t.api.mockCreateApp({ id: t.api.appId, name: "my-site" });
    t.api.mockSiteDeploy({ app_url: APP_URL });

    const result = await t.run("drop", "my-site");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Site deployed successfully");
    t.expectResult(result).toContain(APP_URL);
    expect(t.api.createAppRequests).toEqual([
      expect.objectContaining({
        name: "my-site",
        is_managed_source_code: false,
      }),
    ]);
  });

  it("prints the app id and URL as JSON under --json", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await t.givenUnlinkedProject(fixture("static-drop"));
    t.api.mockCreateApp({ id: t.api.appId, name: "my-site" });
    t.api.mockSiteDeploy({ app_url: APP_URL });

    const result = await t.run("drop", "my-site", "--json");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      appId: t.api.appId,
      appUrl: APP_URL,
    });
  });

  it("fails before creating an app when the folder has no index.html", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await t.givenUnlinkedProject(fixture("static-drop"));
    t.api.mockCreateApp({ id: t.api.appId, name: "no-index" });

    const result = await t.run("drop", "no-index");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No index.html found");
    expect(t.api.createAppRequests).toEqual([]);
  });

  it("reports the server error when the deploy fails", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    await t.givenUnlinkedProject(fixture("static-drop"));
    t.api.mockCreateApp({ id: t.api.appId, name: "my-site" });
    t.api.mockSiteDeployError({ status: 413, body: { error: "Too large" } });

    const result = await t.run("drop", "my-site");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Too large");
  });
});
