import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP = { id: "test-app-id", name: "My App", slug: "my-app" };

describe("slug command", () => {
  const t = setupCLITests();

  it("shows the current slug and app URL", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet(APP);
    t.api.mockSiteUrl({ url: "https://my-app.base44.app" });

    const result = await t.run("slug");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("my-app");
    t.expectResult(result).toContain("https://my-app.base44.app");
  });

  it("outputs JSON with --json", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet(APP);
    t.api.mockSiteUrl({ url: "https://my-app.base44.app" });

    const result = await t.run("slug", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.slug).toBe("my-app");
    expect(parsed.url).toBe("https://my-app.base44.app");
  });

  it("reports when the app has no slug", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet({ ...APP, slug: null });

    const result = await t.run("slug");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("no slug");
  });
});

describe("slug set command", () => {
  const t = setupCLITests();

  it("sets a custom slug and prints old slug, new slug, and URL", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet(APP);
    t.api.mockSlugUpdate({ ...APP, slug: "new-slug" });
    t.api.mockSiteUrl({ url: "https://new-slug.base44.app" });

    const result = await t.run("slug", "set", "new-slug");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("my-app");
    t.expectResult(result).toContain("new-slug");
    t.expectResult(result).toContain("https://new-slug.base44.app");
    expect(t.api.slugUpdateRequests).toEqual([{ slug: "new-slug" }]);
  });

  it("outputs JSON with --json", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet(APP);
    t.api.mockSlugUpdate({ ...APP, slug: "new-slug" });
    t.api.mockSiteUrl({ url: "https://new-slug.base44.app" });

    const result = await t.run("slug", "set", "new-slug", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.previousSlug).toBe("my-app");
    expect(parsed.slug).toBe("new-slug");
    expect(parsed.url).toBe("https://new-slug.base44.app");
  });

  it("fails when the slug format is invalid", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet(APP);
    t.api.mockSlugUpdateError({
      status: 400,
      body: {
        detail:
          "Custom URL must be 3-50 characters and contain only letters, numbers, and hyphens",
      },
    });

    const result = await t.run("slug", "set", "x!");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("3-50 characters");
  });

  it("surfaces suggestions when the slug is already in use", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAppGet(APP);
    t.api.mockSlugUpdateError({
      status: 400,
      body: {
        detail: "URL slug 'taken' is already in use",
        suggestions: ["taken-app", "taken-hq"],
      },
    });

    const result = await t.run("slug", "set", "taken");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("already in use");
    t.expectResult(result).toContain("taken-app");
  });
});

describe("slug reset command", () => {
  const t = setupCLITests();

  it("resets to the auto-generated slug", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSlugUpdate({ ...APP, slug: "my-app-12345678" });
    t.api.mockSiteUrl({ url: "https://my-app-12345678.base44.app" });

    const result = await t.run("slug", "reset");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("my-app-12345678");
    expect(t.api.slugUpdateRequests).toEqual([{ slug: null }]);
  });

  it("surfaces API errors", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSlugUpdateError({
      status: 500,
      body: { detail: "Server error" },
    });

    const result = await t.run("slug", "reset");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Server error");
  });
});
