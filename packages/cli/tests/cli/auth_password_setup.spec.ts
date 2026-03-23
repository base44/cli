import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("auth password-login command", () => {
  const t = setupCLITests();

  it("fails when no action argument is provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "password-login");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("missing required argument");
  });

  it("fails with invalid action argument", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "password-login", "invalid");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("enable");
    t.expectResult(result).toContain("disable");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("auth", "password-login", "enable");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("auth", "password-login", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain(
      "Enable or disable username & password authentication",
    );
  });

  it("shows password-login in auth subcommands", async () => {
    const result = await t.run("auth", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("password-login");
  });

  it("shows pull and push in auth subcommands", async () => {
    const result = await t.run("auth", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("pull");
    t.expectResult(result).toContain("push");
  });
});
