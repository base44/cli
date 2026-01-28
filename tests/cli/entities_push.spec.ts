import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("entities push command", () => {
  const t = setupCLITests();

  it("warns when no entities found in project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("entities", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No entities found in project");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("entities", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("finds and lists entities in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPush({ created: ["Customer", "Product"], updated: [], deleted: [] });

    const result = await t.run("entities", "push");

    t.expectResult(result).toContain("Found 2 entities to push");
    t.expectResult(result).toContain("Customer");
    t.expectResult(result).toContain("Product");
  });

  it("pushes entities successfully and shows results", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPush({ created: ["Customer"], updated: ["Product"], deleted: [] });

    const result = await t.run("entities", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Entities pushed successfully");
    t.expectResult(result).toContain("Created: Customer");
    t.expectResult(result).toContain("Updated: Product");
  });

  it("fails with helpful error when entity is missing required fields", async () => {
    await t.givenLoggedInWithProject(fixture("invalid-entity"));

    const result = await t.run("entities", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("name");
  });

  it("fails with helpful error when config has invalid JSON", async () => {
    await t.givenLoggedInWithProject(fixture("invalid-json"));

    const result = await t.run("entities", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("config.jsonc");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPushError({ status: 500, body: { error: "Internal server error" } });

    const result = await t.run("entities", "push");

    t.expectResult(result).toFail();
  });
});
