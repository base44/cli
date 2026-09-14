import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

/** The commit the fixture "build" came from. */
const GIT_HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

/**
 * What the deploy says when the build left no index.html to finalize with.
 *
 * These all used to read "No index.html found ... a static site needs one at
 * the output directory root" — one message for a missing output directory, an
 * empty one, and one whose entry point sits a level down, which is what sent a
 * production full-stack publish failure looking for a routing bug that was not
 * there. Every case still fails, still fails before the create call, and still
 * carries `INVALID_INPUT`.
 */
describe("site deploy diagnostics when the build output has no root index.html", () => {
  const t = setupCLITests();

  /** The output directory `with-site` configures, in the copied fixture. */
  function siteOutput(): string {
    return join(t.getTempDir(), "project", "site-output");
  }

  it("names the nested entry point when the build split its output", async () => {
    // Given a build that put its entry point a level down, as a client/server
    // split does, and emitted no artifact to ship a server with
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_DEPLOYMENTS_API: "1" });
    await mkdir(join(siteOutput(), "client"), { recursive: true });
    await rename(
      join(siteOutput(), "index.html"),
      join(siteOutput(), "client", "index.html"),
    );

    // When
    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No index.html at the root");
    t.expectResult(result).toContain("3 files there");
    t.expectResult(result).toContain("/client/index.html");
    t.expectResult(result).toContain(".wrangler/deploy/config.json");
    // Resolved before the create call, so nothing left the machine.
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("distinguishes an output directory that was never built", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_DEPLOYMENTS_API: "1" });
    await rm(siteOutput(), { recursive: true, force: true });

    // When
    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Output directory does not exist");
    t.expectResult(result).toNotContain("No index.html");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("distinguishes an output directory a build left empty", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_DEPLOYMENTS_API: "1" });
    await rm(siteOutput(), { recursive: true, force: true });
    await mkdir(siteOutput(), { recursive: true });

    // When
    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No files found in output directory");
    t.expectResult(result).toNotContain("No index.html");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("keeps the INVALID_INPUT code and carries the hints under --json", async () => {
    // Given the shape the platform's publish sandbox runs, whose alerting keys
    // on the code and whose only view of the failure is this document
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_DEPLOYMENTS_API: "1" });
    await mkdir(join(siteOutput(), "client"), { recursive: true });
    await rename(
      join(siteOutput(), "index.html"),
      join(siteOutput(), "client", "index.html"),
    );

    // When
    const result = await t.run(
      "site",
      "deploy",
      "-y",
      "--git-hash",
      GIT_HASH,
      "--json",
    );

    // Then
    t.expectResult(result).toFail();
    const envelope = JSON.parse(result.stdout) as {
      code: string;
      error: string;
      hints?: { message: string }[];
    };
    expect(envelope.code).toBe("INVALID_INPUT");
    expect(envelope.error).toContain("No index.html at the root");
    expect(envelope.hints?.map((hint) => hint.message).join("\n")).toContain(
      "/client/index.html",
    );
  });
});
