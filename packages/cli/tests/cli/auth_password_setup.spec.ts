import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("auth password-login command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("auth", "password-login");

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
});
