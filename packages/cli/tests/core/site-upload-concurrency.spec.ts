import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AssetManifestResult,
  PresignedAssetUpload,
} from "@/core/site/schema.js";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  MAX_BUCKET_CONCURRENCY,
  MAX_UPLOAD_CONCURRENCY,
  uploadDeploymentAssets,
} from "@/core/site/upload.js";

/**
 * Serves PUTs that hold open until released, so the number of requests parked
 * at once is exactly the uploader's in-flight window.
 */
function createGatedServer() {
  let inFlight = 0;
  let peakInFlight = 0;
  const release: Array<() => void> = [];

  const server: Server = createServer((_req, res) => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    release.push(() => {
      inFlight--;
      res.statusCode = 200;
      // The cf arm parses the reply for a completion token; the s3 arm ignores
      // the body. One JSON shape serves both.
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result: { jwt: "completion-jwt" } }));
    });
  });

  return {
    server,
    get peakInFlight() {
      return peakInFlight;
    },
    /** Drain whatever is parked, repeatedly, until every PUT has been answered. */
    async drain(total: number) {
      let answered = 0;
      while (answered < total) {
        if (release.length === 0) {
          await new Promise((r) => setTimeout(r, 5));
          continue;
        }
        const next = release.shift();
        if (next) {
          next();
          answered++;
        }
      }
    },
  };
}

describe("uploadDeploymentAssets — S3 concurrency", () => {
  let dir: string;
  let gate: ReturnType<typeof createGatedServer>;
  let baseUrl: string;

  const TOTAL = 24;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "b44-upload-"));
    gate = createGatedServer();
    await new Promise<void>((resolve) =>
      gate.server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(gate.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      gate.server.closeAllConnections?.();
      gate.server.close(() => resolve());
    });
    await rm(dir, { recursive: true, force: true });
  });

  async function givenAssets(): Promise<{
    uploads: PresignedAssetUpload[];
    assets: AssetManifestResult;
  }> {
    const uploads: PresignedAssetUpload[] = [];
    const manifest: AssetManifestResult["manifest"] = {};
    const filesByHash: AssetManifestResult["filesByHash"] = new Map();

    for (let i = 0; i < TOTAL; i++) {
      const path = `/asset-${i}.txt`;
      const hash = `hash-${i}`;
      const absolutePath = join(dir, `asset-${i}.txt`);
      await writeFile(absolutePath, `content-${i}`);
      manifest[path] = { hash, size: 9 };
      filesByHash.set(hash, {
        absolutePath,
        hash,
        size: 9,
        contentType: "text/plain",
      });
      uploads.push({
        path,
        contentType: "text/plain",
        contentLength: 9,
        url: `${baseUrl}${path}`,
      });
    }

    return { uploads, assets: { manifest, filesByHash } };
  }

  it("keeps DEFAULT_UPLOAD_CONCURRENCY PUTs in flight when the caller names none", async () => {
    const { uploads, assets } = await givenAssets();

    const done = uploadDeploymentAssets({ type: "s3", uploads }, assets);
    await gate.drain(TOTAL);
    await done;

    expect(gate.peakInFlight).toBe(DEFAULT_UPLOAD_CONCURRENCY);
  });

  it("honors an explicit concurrency over the default", async () => {
    const { uploads, assets } = await givenAssets();

    const done = uploadDeploymentAssets({ type: "s3", uploads }, assets, {
      concurrency: 2,
    });
    await gate.drain(TOTAL);
    await done;

    expect(gate.peakInFlight).toBe(2);
  });

  it("clamps the cf arm's buckets even when asked for more", async () => {
    const { assets } = await givenAssets();
    const buckets = Array.from({ length: 12 }, (_, i) => [`hash-${i}`]);

    const done = uploadDeploymentAssets(
      { type: "cf", url: `${baseUrl}/cf`, jwt: "jwt", buckets },
      assets,
      { concurrency: DEFAULT_UPLOAD_CONCURRENCY },
    );
    await gate.drain(buckets.length);
    await done;

    expect(gate.peakInFlight).toBeLessThanOrEqual(MAX_BUCKET_CONCURRENCY);
  });

  it("defaults high enough to matter but stays within the memory ceiling", () => {
    // 3-in-flight put a 25.5k-asset publish at ~930s, outliving its sandbox.
    expect(DEFAULT_UPLOAD_CONCURRENCY).toBeGreaterThan(3);
    expect(DEFAULT_UPLOAD_CONCURRENCY).toBeLessThanOrEqual(
      MAX_UPLOAD_CONCURRENCY,
    );
  });
});
