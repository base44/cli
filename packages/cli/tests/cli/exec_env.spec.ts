import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

// These fail before Deno runs, so unlike exec.spec.ts they are not skipped.
describe("exec command with BASE44_EXEC_* env target", () => {
  const t = setupCLITests();

  it("needs no login or linked project when the env target is set", async () => {
    t.givenEnv({
      BASE44_EXEC_ACCESS_TOKEN: "env-token",
      BASE44_EXEC_SERVER_URL: t.api.baseUrl,
    });

    const result = await t.run("exec", "--app-id", t.api.appId);

    // Reaching the stdin check proves auth and app lookup were skipped.
    t.expectResult(result).toFail();
    expect(stripAnsi(result.stderr)).toContain(
      "No input provided. Pipe a script to stdin.",
    );
    t.expectResult(result).toNotContain("login");
  });

  it("fails clearly when only the access token is set", async () => {
    t.givenEnv({ BASE44_EXEC_ACCESS_TOKEN: "env-token" });
    t.givenStdin("console.log(1)");

    const result = await t.run("exec", "--app-id", t.api.appId);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "BASE44_EXEC_SERVER_URL is not set. BASE44_EXEC_ACCESS_TOKEN and BASE44_EXEC_SERVER_URL must be set together.",
    );
    t.expectResult(result).toNotContain("env-token");
  });

  it("rejects --local with an env target", async () => {
    t.givenEnv({
      BASE44_EXEC_ACCESS_TOKEN: "env-token",
      BASE44_EXEC_SERVER_URL: t.api.baseUrl,
    });
    t.givenStdin("console.log(1)");

    const result = await t.run("exec", "--app-id", t.api.appId, "--local");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--local cannot be used");
  });
});
