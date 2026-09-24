import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const SESSION = "sess-1";
const INDEX = "<!doctype html><div id=root></div>";
const APP_JS = "console.log(1)";

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("publish command", () => {
  const t = setupCLITests();

  const mockPublishApi = () => {
    t.api
      .mockVersionDeclare(SESSION)
      .mockPresignedUpload("/index.html")
      .mockPresignedUpload("/assets/app.js")
      .mockVersionFinalize({ version_id: "ver-1", manifest_hash: "sha256:abc" })
      .mockEnvironmentSet({
        name: "production",
        version_id: "ver-1",
        manifest_hash: "sha256:abc",
        deployment_id: "dep-1",
      });
  };

  it("declares every built file by a full sha256 over its bytes", async () => {
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build");

    t.expectResult(result).toSucceed();
    expect(t.api.versionDeclareRequests[0]).toMatchObject({
      assets: [
        { path: "assets/app.js", size: APP_JS.length, digest: sha256(APP_JS) },
        { path: "index.html", size: INDEX.length, digest: sha256(INDEX) },
      ],
    });
  });

  it("sends the app's resources raw, keyed the way the platform names them", async () => {
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build");

    t.expectResult(result).toSucceed();
    expect(t.api.versionDeclareRequests[0]).toMatchObject({
      entities: {
        Todo: {
          name: "Todo",
          type: "object",
          properties: { title: { type: "string" } },
          // Passed through untouched: the platform's validation is
          // authoritative, and the CLI's own entity schema would refuse this.
          unknown_builder_field: true,
        },
      },
      agents: { helper: { name: "helper", instructions: "help" } },
    });
  });

  it("uploads every declared file with the checksum the server signed in", async () => {
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build");

    t.expectResult(result).toSucceed();
    const uploaded = t.api.presignedUploadRequests;
    expect(uploaded.map((u) => u.path).sort()).toEqual([
      "/assets/app.js",
      "/index.html",
    ]);
    expect(
      uploaded.find((u) => u.path === "/index.html")?.data.toString(),
    ).toBe(INDEX);
  });

  it("names the environment in the path and the version in the body", async () => {
    // Everything else — the app, the principal, env vars — is the platform's to
    // resolve, and there is deliberately no field for any of them.
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build");

    t.expectResult(result).toSucceed();
    expect(t.api.environmentNames).toEqual(["production"]);
    expect(
      Object.keys(t.api.versionDeployRequests[0] as object).sort(),
    ).toEqual(["idempotency_key", "version_id"]);
  });

  it("emits both references in the --json envelope", async () => {
    // Its own field names: `site deploy`'s `deploymentId` means a Cloudflare
    // script on the legacy lane, and a caller that could not tell the two apart
    // would publish by accident.
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build", "--json");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      environment: "production",
      versionId: "ver-1",
      manifestHash: "sha256:abc",
      deploymentId: "dep-1",
    });
  });

  it("names the step that failed", async () => {
    // A user's build failing, a rejected artifact set and a lost publication
    // race are three incidents with three responses.
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    t.api.mockVersionDeclareError({
      status: 409,
      body: { message: "this app declares 3 backend functions" },
    });

    const result = await t.run("publish", "--no-build", "--json");

    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout)).toMatchObject({
      step: "create_version",
      statusCode: 409,
    });
  });

  it("names create_version when the output directory is missing", async () => {
    // Local validation is part of producing the version. Before, this emitted an
    // envelope with no `step`, so a sandbox could not tell a rejected build
    // output from a transport failure.
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));

    const result = await t.run(
      "publish",
      "--no-build",
      "--output-dir",
      "does-not-exist",
      "--json",
    );

    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).step).toBe("create_version");
  });

  it("builds first unless told not to", async () => {
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBe(
      `BUILD_APP=${t.api.appId}`,
    );
  });
});

describe("versions deploy points an environment", () => {
  const t = setupCLITests();

  it("serves an existing version with no build and no upload", async () => {
    // Which is also what a rollback is: the same call with an older version id.
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));
    t.api.mockEnvironmentSet({
      name: "production",
      version_id: "ver-old",
      manifest_hash: "sha256:old",
      deployment_id: "dep-9",
    });

    const result = await t.run("versions", "deploy", "ver-old", "--json");

    t.expectResult(result).toSucceed();
    expect(t.api.environmentNames).toEqual(["production"]);
    expect(t.api.presignedUploadRequests).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual({
      name: "production",
      versionId: "ver-old",
      manifestHash: "sha256:old",
      deploymentId: "dep-9",
    });
  });
});

describe("the versions lane is gated", () => {
  const t = setupCLITests();

  it("does not exist with the gate off", async () => {
    // Not hidden — absent. A command that runs but is unlisted is discoverable
    // by anyone who reads the source, and cannot be un-shipped once someone
    // scripts against it.
    await t.givenLoggedInWithProject(fixture("publishable"));

    for (const argv of [["publish"], ["versions", "deploy", "ver-1"]]) {
      const result = await t.run(...argv);

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("unknown command");
    }
  });

  it("is absent from --help with the gate off", async () => {
    await t.givenLoggedInWithProject(fixture("publishable"));

    const result = await t.run("--help");

    expect(result.stdout).not.toContain("publish");
    expect(result.stdout).not.toContain("versions");
  });

  it("appears once the gate is on", async () => {
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("publishable"));

    const result = await t.run("--help");

    expect(result.stdout).toContain("publish");
    expect(result.stdout).toContain("versions");
  });
});

describe("publish command, for an app with a server of its own", () => {
  const t = setupCLITests();

  // The Worker's own build directory, and the assets directory it serves from.
  const SERVER_INDEX =
    'import handler from "./assets/chunk-abc.js";\nexport default { fetch: handler };\n';
  const CLIENT_INDEX = "<h1>Hello</h1>\n";

  const mockFullStackApi = () =>
    t.api
      .mockVersionDeclare(SESSION)
      .mockPresignedUpload("/index.html")
      .mockPresignedUpload("/assets/app-123.js")
      .mockPresignedUpload("/index.js")
      .mockPresignedUpload("/index.js.map")
      .mockPresignedUpload("/assets/chunk-abc.js")
      .mockVersionFinalize({ version_id: "ver-1", manifest_hash: "sha256:abc" })
      .mockEnvironmentSet({
        name: "production",
        version_id: "ver-1",
        manifest_hash: "sha256:abc",
        deployment_id: "dep-1",
      });

  async function publish() {
    t.givenEnv({ BASE44_VERSIONS_API: "1" });
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    mockFullStackApi();
    return await t.run("publish", "--no-build");
  }

  it("declares the Worker alongside the frontend, in one version", async () => {
    // One build, one source commit, one version — the app's assets and the
    // app's server are the same app.
    const result = await publish();

    t.expectResult(result).toSucceed();
    expect(t.api.versionDeclareRequests[0]).toMatchObject({
      site_worker: {
        main: "index.js",
        compatibility_date: "2025-04-01",
        compatibility_flags: ["nodejs_compat"],
      },
    });
  });

  it("takes the assets from the Worker's own directory", async () => {
    // Collecting the project's build output instead would ask the platform to
    // serve the Worker's files from S3, past every route it owns.
    const result = await publish();

    t.expectResult(result).toSucceed();
    const declared = t.api.versionDeclareRequests[0] as {
      assets: Array<{ path: string }>;
      site_worker: { modules: Array<{ path: string }> };
    };
    expect(declared.assets.map((f) => f.path)).toEqual([
      "assets/app-123.js",
      "index.html",
    ]);
    expect(declared.site_worker.modules.map((m) => m.path).sort()).toEqual([
      "assets/chunk-abc.js",
      "index.js",
      "index.js.map",
    ]);
  });

  it("puts each declared file's own bytes at the URL signed for it", async () => {
    // Paired by position, not by path: `index.js` names a module here and an
    // asset in other builds, and swapping the two would upload each under the
    // other's checksum.
    const result = await publish();

    t.expectResult(result).toSucceed();
    const uploaded = new Map(
      t.api.presignedUploadRequests.map((u) => [u.path, u.data.toString()]),
    );
    expect(uploaded.get("/index.js")).toBe(SERVER_INDEX);
    expect(uploaded.get("/index.html")).toBe(CLIENT_INDEX);
  });
});
