import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("exec command", () => {
  const t = setupCLITests();

  it("shows help with --help flag", async () => {
    const result = await t.run("exec", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Run a script with the Base44 SDK");
  });

  it("fails with helpful error when no stdin is piped", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("exec");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No input provided");
    t.expectResult(result).toContain("cat ./script.ts | base44 exec");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenStdin("console.log(1)");

    const result = await t.run("exec");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails when token exchange returns an error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockError("get", `/api/apps/test-app-id/auth/token`, {
      status: 500,
      body: { error: "Internal server error" },
    });
    t.givenStdin("console.log(1)");

    const result = await t.run("exec");

    t.expectResult(result).toFail();
  });

  it("executes piped code successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });
    t.givenStdin("console.log('hello from exec')");

    // Note: script output goes directly to terminal (stdio: inherit), not captured here
    const result = await t.run("exec");

    t.expectResult(result).toSucceed();
  });
});
