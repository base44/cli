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
      .mockVersionFinalize({
        version_id: "ver-1",
        manifest_hash: "sha256:abc",
        deduplicated: false,
      })
      .mockVersionDeploy({
        deployment_id: "dep-1",
        manifest_hash: "sha256:abc",
        revision: 4,
      });
  };

  it("declares every built file by a full sha256 over its bytes", async () => {
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build");

    t.expectResult(result).toSucceed();
    expect(t.api.versionDeclareRequests[0]).toMatchObject({
      static_bundle: [
        { path: "assets/app.js", size: APP_JS.length, digest: sha256(APP_JS) },
        { path: "index.html", size: INDEX.length, digest: sha256(INDEX) },
      ],
    });
  });

  it("sends the app's resources raw, keyed the way the platform names them", async () => {
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

  it("carries only a target name and a retry key into the deploy", async () => {
    // Everything else — the app, the principal, env vars, the revision — is the
    // platform's to resolve, and there is deliberately no field for any of them.
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build");

    t.expectResult(result).toSucceed();
    expect(t.api.versionDeployIds).toEqual(["ver-1"]);
    expect(Object.keys(t.api.versionDeployRequests[0] as object)).toEqual([
      "idempotency_key",
    ]);
  });

  it("emits both references in the --json envelope", async () => {
    // Its own field names: `site deploy`'s `deploymentId` means a Cloudflare
    // script on the legacy lane, and a caller that could not tell the two apart
    // would publish by accident.
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish", "--no-build", "--json");

    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      versionId: "ver-1",
      manifestHash: "sha256:abc",
      deduplicated: false,
      deploymentId: "dep-1",
      revision: 4,
    });
  });

  it("names the step that failed", async () => {
    // A user's build failing, a rejected artifact set and a lost publication
    // race are three incidents with three responses.
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

  it("builds first unless told not to", async () => {
    await t.givenLoggedInWithProject(fixture("publishable"));
    mockPublishApi();

    const result = await t.run("publish");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("build-env.txt")).toBe(
      `BUILD_APP=${t.api.appId}`,
    );
  });
});

describe("version deploy command", () => {
  const t = setupCLITests();

  it("serves an existing version with no build and no upload", async () => {
    // Which is also what a rollback is: the same call with an older version id.
    await t.givenLoggedInWithProject(fixture("publishable"));
    t.api.mockVersionDeploy({
      deployment_id: "dep-9",
      manifest_hash: "sha256:old",
      revision: 12,
    });

    const result = await t.run("version", "deploy", "ver-old", "--json");

    t.expectResult(result).toSucceed();
    expect(t.api.versionDeployIds).toEqual(["ver-old"]);
    expect(t.api.presignedUploadRequests).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual({
      deploymentId: "dep-9",
      manifestHash: "sha256:old",
      revision: 12,
    });
  });
});
