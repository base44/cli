/**
 * Ported from apper's TestBundleSizeMeasurement in
 * backend/tests/unit/app/cloudflare_functions/test_worker_bundle_size_limits.py.
 * The constants and the verdict order are the contract; the rest of that file
 * is deploy machinery and stays with the service.
 */

import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_GZIP_LEVEL,
  judgeBundleSize,
  measureBundleBytes,
  WORKER_RAW_SIZE_CEILING_BYTES,
  workerGzipCapBreach,
  workerRawSizeBreach,
} from "../src/shards/size";

describe("measurement", () => {
  it("counts raw as UTF-8 bytes and gzip as the compressed size", async () => {
    const module = `const א = 1;${"x".repeat(5000)}`;
    const { rawBytes, gzipBytes } = await measureBundleBytes(module);

    expect(rawBytes).toBe(Buffer.byteLength(module, "utf8"));
    expect(rawBytes).toBeGreaterThan(module.length); // the non-ASCII identifier
    expect(gzipBytes).toBe(
      gzipSync(Buffer.from(module, "utf8"), { level: BUNDLE_GZIP_LEVEL })
        .byteLength,
    );
    expect(gzipBytes).toBeLessThan(rawBytes);
  });
});

describe("ceilings", () => {
  it("passes a module under both", () => {
    expect(workerRawSizeBreach(1_000_000)).toBeNull();
    expect(workerGzipCapBreach(200_000, 9_000_000)).toBeNull();
  });

  it("puts the raw ceiling exactly where Cloudflare says it is", () => {
    // Cloudflare's own 10027 reads "exceeded the uncompressed size limit of
    // 64 MiB", so the constant is 64 MiB in CF's units — decimal 64_000_000
    // would refuse 3 MiB early for no reason.
    expect(WORKER_RAW_SIZE_CEILING_BYTES).toBe(67_108_864);
    expect(workerRawSizeBreach(67_108_864)).toBeNull();
    expect(workerRawSizeBreach(67_108_865)).not.toBeNull();
  });

  it("refuses the one real production rejection without uploading it", async () => {
    // App 6a8c58a3, 2026-08-24: a single function whose module reached 97.4 MiB.
    // Unsplittable, and it spent 30 s uploading 97 MB to be told the same thing.
    const breach = workerRawSizeBreach(102_160_553);
    expect(breach).not.toBeNull();
    expect(breach).toContain("uncompressed");
    expect(breach).toContain("64 MiB");
  });

  it("refuses over the compressed cap too", () => {
    expect(workerGzipCapBreach(9_500_001, 9_500_000)).not.toBeNull();
    expect(workerGzipCapBreach(9_500_000, 9_500_000)).toBeNull();
  });

  it("reports the uncompressed breach when both are over", async () => {
    // The exact one wins: it is the verdict Cloudflare would give.
    const verdict = await judgeBundleSize(
      "x".repeat(WORKER_RAW_SIZE_CEILING_BYTES + 1),
      1,
    );
    expect(verdict.breach).toContain("uncompressed");
  });

  it("returns the sizes and no breach for a module within both", async () => {
    const verdict = await judgeBundleSize("export default 1;", 9_500_000);
    expect(verdict.breach).toBeNull();
    expect(verdict.rawBytes).toBe(17);
    expect(verdict.gzipBytes).toBeGreaterThan(0);
  });
});

describe("the headroom the cap was chosen for", () => {
  // The regression net for the cap: real production figures it has to keep
  // clearing. Ported from apper's TestBundleSizeMeasurement, and they matter
  // more in this lane than in that one — Node's gzip reads ~0.7% heavier than
  // Python's on identical input, so we sit that much closer to the cap.
  it("clears the biggest bundle in production", () => {
    // 8,495,351 B gzipped from 14.4 MB raw — app 6a04bc98, ~40 uploads a day,
    // the largest compressed module over n=166,471 bundles. The ~1.0 MB (11.8%)
    // it clears by IS the safety margin. Re-check this number before assuming a
    // firing cap is wrong.
    expect(workerRawSizeBreach(14_446_791)).toBeNull();
    expect(workerGzipCapBreach(8_495_351, 9_500_000)).toBeNull();
  });

  it("clears a barely compressible bundle too", () => {
    // Second-largest: 7,935,787 B from 11.8 MB raw, a 1.49x ratio against a
    // measured floor of 1.33x. Raw size predicts compressed size loosely, which
    // is why the verdict is taken on the compressed figure and never
    // extrapolated from raw.
    expect(workerRawSizeBreach(11_809_821)).toBeNull();
    expect(workerGzipCapBreach(7_935_787, 9_500_000)).toBeNull();
  });

  it("does not refuse the largest module production ever uploaded", async () => {
    // 35.3 MiB raw, uploaded successfully five times. A cap that refuses it is
    // wrong however defensible the arithmetic looked.
    const parts: string[] = [];
    for (let i = 0; i < 700_000; i++) {
      parts.push(`const v${i}=1;function f${i}(){return v${i}};`);
    }
    const { rawBytes, gzipBytes } = await measureBundleBytes(parts.join(""));

    expect(rawBytes).toBeGreaterThan(20_000_000);
    expect(workerRawSizeBreach(rawBytes)).toBeNull();
    expect(workerGzipCapBreach(gzipBytes, 9_000_000)).toBeNull();
  }, 60_000);
});

describe("compression stays off the event loop", () => {
  it("keeps the loop servicing while a large module compresses", async () => {
    // Level 6 on the largest module production has uploaded costs ~650 ms in
    // apper's measurement. Held on the loop it stalls everything else in the
    // process, and concurrent shard builds queue behind each other.
    const module = randomBytes(6_000_000).toString("hex");
    let ticks = 0;
    const beat = setInterval(() => {
      ticks += 1;
    }, 1);
    try {
      await measureBundleBytes(module);
    } finally {
      clearInterval(beat);
    }

    // Blocking would leave this at 0; offloaded to the zlib threadpool, the loop
    // keeps firing timers.
    expect(ticks).toBeGreaterThan(3);
  }, 60_000);
});

describe("the Python and Node gzips do not agree", () => {
  it("keeps the level pinned, because the two lanes measure differently", async () => {
    // Measured on a real 122,324-byte compiled module: Python's gzip.compress
    // at level 6 gives 42,765 bytes, Node's gzipSync gives 43,057 — Node reads
    // ~0.7% heavier on identical input. So a module within ~0.7% of the cap can
    // pass one lane and fail the other.
    //
    // The direction is the safe one: the local gate refuses slightly earlier
    // than the service would, so nothing doomed slips through locally. It does
    // mean a function very near the cap could build in apper and be refused
    // here. Pinning the level is what keeps the gap this small and stable.
    expect(BUNDLE_GZIP_LEVEL).toBe(6);

    const module = "export const x = 1;".repeat(2000);
    const { gzipBytes } = await measureBundleBytes(module);
    expect(gzipBytes).toBe(
      gzipSync(Buffer.from(module, "utf8"), { level: 6 }).byteLength,
    );
  });
});
