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

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("site", "open");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSiteUrlError({ status: 404, body: { detail: "App not found" } });

    const result = await t.run("site", "open");

    t.expectResult(result).toFail();
  });
});
