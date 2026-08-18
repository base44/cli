import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

/** The commit the fixture "build" came from. */
const GIT_HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const DEPLOYMENT_ID = "test-app-git-0f1e2d3c4b5a";
/** The upload session the server opens for one deploy attempt. */
const SESSION_ID = "3f9a1c07b8e44d2f";

/** Server-side content types differ from the CLI's own mapping on purpose —
 * the tests prove the signed value wins. */
const SIGNED_CONTENT_TYPES: Record<string, string> = {
  "/main.js": "application/javascript",
  "/styles.css": "text/css",
};

/** Byte counts the server signs into the URLs (from the real fixture files). */
const FIXTURE_SIZES: Record<string, number> = Object.fromEntries(
  ["/main.js", "/styles.css"].map((path) => [
    path,
    readFileSync(join(fixture("with-site"), "site-output", path.slice(1)))
      .length,
  ]),
);

interface CreateBody {
  git_hash: string;
  asset_manifest: Record<string, { hash: string; size: number }>;
}

describe("site deploy command (static site through the deployments API, env-gated)", () => {
  const t = setupCLITests();

  /** The s3 create arm: presigned PUT targets for the requested paths. */
  function mockStaticCreate(uploadPaths: string[]) {
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads:
        uploadPaths.length === 0
          ? null
          : {
              type: "s3" as const,
              uploads: uploadPaths.map((path) => ({
                path,
                // Deliberately not what the CLI would derive: the signed value wins.
                content_type: `${SIGNED_CONTENT_TYPES[path]}; charset=utf-8`,
                content_length: FIXTURE_SIZES[path],
                url: `${t.api.baseUrl}/presigned${path}`,
              })),
            },
    });
    for (const path of uploadPaths) {
      t.api.mockPresignedUpload(path);
    }
  }

  async function readSiteFile(name: string): Promise<Buffer> {
    return await readFile(join(fixture("with-site"), "site-output", name));
  }

  it("keeps --git-hash out of the help while the gate is off", async () => {
    const siteDeployHelp = await t.run("site", "deploy", "--help");

    t.expectResult(siteDeployHelp).toSucceed();
    t.expectResult(siteDeployHelp).toContain("--build");
    t.expectResult(siteDeployHelp).toNotContain("--git-hash");
  });

  it("rejects --git-hash outright while the gate is off", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("unknown option");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("shows --git-hash on site deploy once the gate is on", async () => {
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });

    const result = await t.run("site", "deploy", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("--git-hash");
  });

  it("keeps the legacy tar.gz site upload when the gate is off", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.api.mockSiteDeploy({ app_url: "https://legacy.example.com" });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("https://legacy.example.com");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("deploys the site output through the deployments API when gated on", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });
    mockStaticCreate(["/main.js", "/styles.css"]);
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 3 static assets (2 new)");
    t.expectResult(result).toContain("Site deployed");
    t.expectResult(result).toContain(DEPLOYMENT_ID);

    expect(t.api.deploymentCreateRequests).toHaveLength(1);
    const body = t.api.deploymentCreateRequests[0] as CreateBody;
    expect(body.git_hash).toBe(GIT_HASH);
    expect(body).not.toHaveProperty("config");
    expect(Object.keys(body.asset_manifest).sort()).toEqual([
      "/index.html",
      "/main.js",
      "/styles.css",
    ]);

    expect(t.api.presignedUploadRequests).toHaveLength(2);
    const byPath = new Map(
      t.api.presignedUploadRequests.map((r) => [r.path, r]),
    );
    const mainJs = byPath.get("/main.js");
    expect(mainJs?.data.equals(await readSiteFile("main.js"))).toBe(true);
    expect(mainJs?.contentType).toBe("application/javascript; charset=utf-8");
    expect(mainJs?.authorization).toBeUndefined();
    const styles = byPath.get("/styles.css");
    expect(styles?.data.equals(await readSiteFile("styles.css"))).toBe(true);
    expect(styles?.contentType).toBe("text/css; charset=utf-8");
    expect(styles?.authorization).toBeUndefined();

    expect(t.api.finalizeRequests).toHaveLength(1);
    // Finalize resolves this attempt's session, not the commit-derived one a
    // concurrent deploy of the same commit shares.
    expect(t.api.finalizeQueries[0]).toEqual({ session_id: SESSION_ID });
    const fields = t.api.finalizeRequests[0];
    expect(fields.map((f) => f.name)).toEqual(["index.html"]);
    expect(fields[0].data.equals(await readSiteFile("index.html"))).toBe(true);
    // Bun's compiled binary normalizes Blob types to include the charset.
    expect(fields[0].contentType).toMatch(/^text\/html(;\s*charset=utf-8)?$/i);
  });

  it("sends no PUTs and still finalizes when every asset is already stored", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "true" });
    mockStaticCreate([]);
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 3 static assets (0 new)");
    expect(t.api.presignedUploadRequests).toHaveLength(0);
    expect(t.api.finalizeRequests).toHaveLength(1);
    expect(t.api.finalizeRequests[0].map((f) => f.name)).toEqual([
      "index.html",
    ]);
  });

  it("emits a single JSON document with --json", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });
    mockStaticCreate(["/main.js", "/styles.css"]);
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run(
      "site",
      "deploy",
      "-y",
      "--git-hash",
      GIT_HASH,
      "--json",
    );

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      deploymentId: DEPLOYMENT_ID,
      gitHash: GIT_HASH,
    });
  });

  it("deploys past an entity file the CLI would reject", async () => {
    // A site deploy reads no entity files, so one it can't parse is unrelated —
    // builder-managed entity schemas failed every publish through this path.
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });
    const entitiesDir = join(t.getTempDir(), "project", "base44", "entities");
    await mkdir(entitiesDir, { recursive: true });
    await writeFile(
      join(entitiesDir, "Broken.jsonc"),
      JSON.stringify({ name: "Broken", rls: { create: "nonsense" } }),
    );
    mockStaticCreate(["/main.js", "/styles.css"]);
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    expect(t.api.finalizeRequests).toHaveLength(1);
  });

  it("reports the rejected status in the --json error envelope", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });
    t.api.mockError("post", "/api/apps/test-app-id/deployments", {
      status: 401,
      body: { message: "API key is not valid" },
    });

    const result = await t.run(
      "site",
      "deploy",
      "-y",
      "--git-hash",
      GIT_HASH,
      "--json",
    );

    t.expectResult(result).toFail();
    // A caller reading only `error` can't tell a rejected key from a 500.
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "API_ERROR",
      statusCode: 401,
    });
  });

  it("takes the legacy path when the gate is on but no commit is passed", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });
    t.api.mockSiteDeploy({ app_url: "https://legacy.example.com" });

    const result = await t.run("site", "deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("https://legacy.example.com");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("rejects a --git-hash that is not a commit hash", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });

    const result = await t.run("site", "deploy", "-y", "--git-hash", "nope");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Expected a git commit hash");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("uploads every asset under a --concurrency override", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });
    mockStaticCreate(["/main.js", "/styles.css"]);
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run(
      "site",
      "deploy",
      "-y",
      "--git-hash",
      GIT_HASH,
      "--concurrency",
      "1",
    );

    t.expectResult(result).toSucceed();
    expect(t.api.presignedUploadRequests).toHaveLength(2);
  });

  it("rejects a --concurrency outside the allowed range", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));
    t.givenEnv({ BASE44_STATIC_DEPLOYMENTS: "1" });

    const zero = await t.run("site", "deploy", "-y", "--concurrency", "0");
    const huge = await t.run("site", "deploy", "-y", "--concurrency", "999");

    t.expectResult(zero).toFail();
    t.expectResult(zero).toContain("between 1 and 50");
    t.expectResult(huge).toFail();
    t.expectResult(huge).toContain("between 1 and 50");
  });

  it("hides --concurrency while the gate is off", async () => {
    const result = await t.run("site", "deploy", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toNotContain("--concurrency");
  });
});
