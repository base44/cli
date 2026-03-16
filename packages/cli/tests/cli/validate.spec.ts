import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("validate command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    const result = await t.run("validate");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("succeeds with only a config file and no resource files", async () => {
    await t.givenProject(fixture("basic"));

    const result = await t.run("validate");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("valid");
  });

  it("shows valid entities as passing", async () => {
    await t.givenProject(fixture("with-entities"));

    const result = await t.run("validate");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("entities");
  });

  it("fails and shows error for invalid entity", async () => {
    await t.givenProject(fixture("invalid-entity"));

    const result = await t.run("validate");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("name");
  });

  it("fails and shows error for invalid agent", async () => {
    await t.givenProject(fixture("invalid-agent"));

    const result = await t.run("validate");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("agents");
  });

  it("fails and shows error for invalid function config", async () => {
    await t.givenProject(fixture("invalid-function-config"));

    const result = await t.run("validate");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("function");
  });

  it("validates all resource types in a full project", async () => {
    await t.givenProject(fixture("full-project"));

    const result = await t.run("validate");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("valid");
  });

  it("collects all errors without stopping at first failure", async () => {
    await t.givenProject(fixture("invalid-entity"));

    const result = await t.run("validate");

    // Should show a summary with count, not just bail on first file
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("failed");
  });

  it("does not require authentication", async () => {
    // No login, just project setup
    await t.givenProject(fixture("with-entities"));

    const result = await t.run("validate");

    // Should not fail with auth error
    t.expectResult(result).toSucceed();
  });
});
