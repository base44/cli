import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("dashboard open command", () => {
  const t = setupCLITests();

  it("opens dashboard URL when in a project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("dashboard", "open");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Dashboard opened");
    t.expectResult(result).toContain("test-app-id");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("dashboard", "open");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });
});
