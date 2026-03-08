import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("exec command", () => {
  const t = setupCLITests();

  it("shows help with --help flag", async () => {
    const result = await t.run("exec", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Run a script with the Base44 SDK");
    t.expectResult(result).toContain("[script]");
    t.expectResult(result).toContain("-e, --eval");
    t.expectResult(result).toContain("or - for stdin");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("exec", "some-script.ts");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails when multiple input modes are provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("exec", "script.ts", "-e", "console.log(1)");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Cannot use more than one input mode");
  });

  it("fails when token exchange returns an error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockError("get", `/api/apps/test-app-id/auth/token`, {
      status: 500,
      body: { error: "Internal server error" },
    });

    const result = await t.run("exec", "-e", "console.log(1)");

    t.expectResult(result).toFail();
  });

  it("executes inline code successfully with -e flag", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAuthToken("test-app-token");
    t.api.mockSiteUrl({ url: "https://test-app.base44.app" });

    // Note: script output goes directly to terminal (stdio: inherit), not captured here
    const result = await t.run("exec", "-e", "console.log('hello from exec')");

    t.expectResult(result).toSucceed();
  });
});
