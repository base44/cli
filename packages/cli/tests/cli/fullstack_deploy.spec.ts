import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

function assetHash(appId: string, content: string): string {
  return createHash("sha256")
    .update(Buffer.from(appId, "utf8"))
    .update(Buffer.from(content))
    .digest("hex")
    .slice(0, 32);
}

const INDEX_HTML = "<h1>Hello</h1>\n";
const APP_JS = 'console.log("app");\n';

/** The fixture is not a git repo, so every deploy passes --git-hash. */
const GIT_HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const DEPLOYMENT_ID = "test-app-git-a1b2c3d4e5f6";
const SESSION_ID = "3f9a1c07b8e44d2f";

interface CreateBody {
  git_hash: string;
  config: {
    main: string;
    compatibility_date: string | null;
    compatibility_flags: string[];
    assets: Record<string, unknown> | null;
  };
  asset_manifest: Record<string, { hash: string; size: number }>;
}

describe("site deploy command (full-stack)", () => {
  const t = setupCLITests();

  function mockHappyPath(options?: { buckets?: string[][] }) {
    const htmlHash = assetHash(t.api.appId, INDEX_HTML);
    const jsHash = assetHash(t.api.appId, APP_JS);
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: {
        type: "cf",
        url: `${t.api.baseUrl}/cf-assets/upload`,
        jwt: "upload-session-jwt",
        buckets: options?.buckets ?? [[htmlHash], [jsHash]],
      },
    });
    t.api.mockAssetUpload("completion-jwt");
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });
    return { htmlHash, jsHash };
  }

  it("deploys a full-stack artifact: manifest hashes, bucket relay, finalize modules", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    const { htmlHash, jsHash } = mockHappyPath();

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 2 static assets (2 new)");
    t.expectResult(result).toContain("Full-stack app deployed");
    t.expectResult(result).toContain(`Deployment ${DEPLOYMENT_ID}`);

    expect(t.api.deploymentCreateRequests).toHaveLength(1);
    const body = t.api.deploymentCreateRequests[0] as CreateBody;
    expect(body.git_hash).toBe(GIT_HASH);
    expect(body.config.main).toBe("index.js");
    expect(body.config.compatibility_date).toBe("2025-04-01");
    expect(body.config.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(body).not.toHaveProperty("modules");
    expect(body.config).not.toHaveProperty("vars");
    expect(body.asset_manifest).toEqual({
      "/index.html": { hash: htmlHash, size: INDEX_HTML.length },
      "/assets/app-123.js": { hash: jsHash, size: APP_JS.length },
    });
    expect(Object.keys(body.asset_manifest)).not.toContain("/ignored.txt");
    expect(Object.keys(body.asset_manifest)).not.toContain("/.assetsignore");

    // The fixture's wrangler config carries vars — surfaced, not sent.
    t.expectResult(result).toContain("wrangler 'vars' are not supported");

    expect(t.api.assetUploadRequests).toHaveLength(2);
    for (const upload of t.api.assetUploadRequests) {
      expect(upload.authorization).toBe("Bearer upload-session-jwt");
      expect(upload.base64Query).toBe("true");
    }
    const uploadedFields = t.api.assetUploadRequests.flatMap((r) => r.fields);
    const uploadedByName = new Map(uploadedFields.map((f) => [f.name, f]));
    expect([...uploadedByName.keys()].sort()).toEqual(
      [htmlHash, jsHash].sort(),
    );
    expect(
      Buffer.from(
        uploadedByName.get(htmlHash)?.data.toString() ?? "",
        "base64",
      ).toString(),
    ).toBe(INDEX_HTML);
    // Bun's compiled binary normalizes Blob types to include the charset.
    expect(uploadedByName.get(htmlHash)?.contentType).toMatch(
      /^text\/html(;\s*charset=utf-8)?$/i,
    );

    expect(t.api.finalizeRequests).toHaveLength(1);
    const finalizeFields = t.api.finalizeRequests[0];
    const payloadField = finalizeFields.find((f) => f.name === "payload");
    expect(JSON.parse(payloadField?.data.toString() ?? "{}")).toEqual({
      completion_jwt: "completion-jwt",
    });
    const fieldNames = finalizeFields.map((f) => f.name).sort();
    expect(fieldNames).toEqual([
      "assets/chunk-abc.js",
      "index.js",
      "index.js.map",
      "payload",
    ]);
    expect(finalizeFields.find((f) => f.name === "index.js")?.contentType).toBe(
      "application/javascript+module",
    );
    expect(
      finalizeFields.find((f) => f.name === "index.js.map")?.contentType,
    ).toBe("application/source-map");
  });

  it("finalizes with a null completion token when every asset is already stored", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    expect(t.api.assetUploadRequests).toHaveLength(0);
    const payloadField = t.api.finalizeRequests[0].find(
      (f) => f.name === "payload",
    );
    expect(JSON.parse(payloadField?.data.toString() ?? "{}")).toEqual({
      completion_jwt: null,
    });
  });

  it("normalizes and requires a commit hash", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));

    const noHash = await t.run("site", "deploy", "-y");
    t.expectResult(noHash).toFail();
    t.expectResult(noHash).toContain("--git-hash");

    // Rejected by the option's argParser, before the action (and any resource
    // push) runs.
    const badHash = await t.run(
      "site",
      "deploy",
      "-y",
      "--git-hash",
      "not-a-hash",
    );
    t.expectResult(badHash).toFail();
    t.expectResult(badHash).toContain("Expected a git commit hash");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("outputs a single JSON document with --json", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    mockHappyPath();

    const result = await t.run(
      "site",
      "deploy",
      "-y",
      "--json",
      "--git-hash",
      GIT_HASH,
    );

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual({
      deploymentId: DEPLOYMENT_ID,
      gitHash: GIT_HASH,
    });
  });

  it("warns when the wrangler config lacks the nodejs_compat flag (e.g. Astro 6)", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    const configPath = join(
      t.getTempDir(),
      "project",
      "build",
      "server",
      "wrangler.json",
    );
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.compatibility_flags = [];
    await writeFile(configPath, JSON.stringify(config));
    mockHappyPath();

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("no 'nodejs_compat' compatibility flag");
    const body = t.api.deploymentCreateRequests[0] as CreateBody;
    expect(body.config.compatibility_flags).toEqual([]);
  });

  it("retries a bucket upload after a transient failure, resending the body", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    const htmlHash = assetHash(t.api.appId, INDEX_HTML);
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: {
        type: "cf",
        url: `${t.api.baseUrl}/cf-assets/upload`,
        jwt: "upload-session-jwt",
        buckets: [[htmlHash]],
      },
    });
    t.api.mockAssetUploadAfterFailures(2, "completion-jwt");
    t.api.mockDeploymentFinalize({ deployment_id: DEPLOYMENT_ID });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toSucceed();
    expect(t.api.assetUploadRequests).toHaveLength(3);
    // Every attempt carried the full body: ky clones a pristine request, so
    // attempt one does not consume the FormData.
    for (const upload of t.api.assetUploadRequests) {
      expect(upload.authorization).toBe("Bearer upload-session-jwt");
      const field = upload.fields.find((f) => f.name === htmlHash);
      expect(
        Buffer.from(field?.data.toString() ?? "", "base64").toString(),
      ).toBe(INDEX_HTML);
    }
    const payload = t.api.finalizeRequests[0].find((f) => f.name === "payload");
    expect(JSON.parse(payload?.data.toString() ?? "{}")).toEqual({
      completion_jwt: "completion-jwt",
    });
  }, 20_000);

  it("surfaces a session-expired error when Cloudflare rejects the session jwt", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: {
        type: "cf",
        url: `${t.api.baseUrl}/cf-assets/upload`,
        jwt: "expired-jwt",
        buckets: [[assetHash(t.api.appId, INDEX_HTML)]],
      },
    });
    t.api.mockAssetUploadError({ status: 401, body: { error: "expired" } });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("upload session has expired");
  }, 20_000);

  it("fails when the deployment API rejects the create call", async () => {
    await t.givenLoggedInWithProject(fixture("fullstack-project"));
    t.api.mockError("post", `/api/apps/${t.api.appId}/deployments`, {
      status: 422,
      body: { message: "unsupported artifact" },
    });

    const result = await t.run("site", "deploy", "-y", "--git-hash", GIT_HASH);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("unsupported artifact");
  });
});
