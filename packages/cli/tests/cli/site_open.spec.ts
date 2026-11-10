import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("site open command", () => {
  const t = setupCLITests();

  it("opens site URL when in a project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSiteUrl({ url: "https://my-app.base44.app" });

    const result = await t.run("site", "open");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Site opened");
    t.expectResult(result).toContain("https://my-app.base44.app");
  });

  it("opens site URL with --app-id outside a project", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockSiteUrl({ url: "https://projectless.base44.app" });

    const result = await t.run("site", "open", "--app-id", t.api.appId);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Site opened");
    t.expectResult(result).toContain("https://projectless.base44.app");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("site", "open");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("says the app is not published when it has no published URL", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSiteUrlError({ status: 404, body: { detail: "App not found" } });

    const result = await t.run("site", "open");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("has not been published yet");
    t.expectResult(result).toContain("base44 deploy");
    t.expectResult(result).toNotContain("App not found");
  });

  it("fails with the server error when the URL lookup fails otherwise", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSiteUrlError({ status: 500, body: { detail: "Server error" } });

    const result = await t.run("site", "open");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Server error");
    t.expectResult(result).toNotContain("has not been published yet");
  });
});
