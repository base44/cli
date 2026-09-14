/**
 * How large a compiled Worker module is, and whether Cloudflare will take it.
 *
 * Ported from apper's `cloudflare_wfp_runtime.py` (`measure_bundle_bytes`,
 * `worker_raw_size_breach`, `worker_gzip_cap_breach`, `judge_bundle_size`).
 * Deciding this before an upload is the whole point: the one real production
 * rejection spent 30 seconds uploading 97 MB to be told the same thing this
 * computes for free.
 */

import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

/** zlib's default, and the level `wrangler --dry-run` reports — so the number
 *  here means the same thing as the one in Cloudflare's docs, in a support
 *  thread and on a developer's terminal. It is not a claim about Cloudflare's
 *  own server-side compressor, which is unpublished; the safety margin lives in
 *  the cap instead. */
export const BUNDLE_GZIP_LEVEL = 6;

/** Cloudflare's uncompressed per-Worker ceiling, in the units Cloudflare states
 *  it in. Taken from a real 10027 in production, which reads verbatim: "Your
 *  Worker exceeded the uncompressed size limit of 64 MiB." Decimal 64_000_000
 *  would refuse 3 MiB early for no reason. */
export const WORKER_RAW_SIZE_CEILING_BYTES = 64 * 1024 * 1024;

export interface BundleSize {
  rawBytes: number;
  gzipBytes: number;
}

export interface SizeVerdict extends BundleSize {
  /** Why the module is over a ceiling, or `null` when it is within both. */
  breach: string | null;
}

/** `(raw, gzip)` for a compiled module. Compression runs off the event loop:
 *  a multi-megabyte gzip is long enough to matter when several shards are in
 *  flight. */
export async function measureBundleBytes(module: string): Promise<BundleSize> {
  const raw = Buffer.from(module, "utf8");
  const compressed = await gzipAsync(raw, { level: BUNDLE_GZIP_LEVEL });
  return { rawBytes: raw.byteLength, gzipBytes: compressed.byteLength };
}

/** Why Cloudflare will reject this module outright, or `null`. The only verdict
 *  taken on a number Cloudflare states itself — no estimate, no compression, no
 *  headroom to argue about. */
export function workerRawSizeBreach(rawBytes: number): string | null {
  if (rawBytes > WORKER_RAW_SIZE_CEILING_BYTES) {
    return (
      `bundled module is ${rawBytes} bytes uncompressed, over Cloudflare's ` +
      `${WORKER_RAW_SIZE_CEILING_BYTES}-byte (64 MiB) per-Worker ceiling`
    );
  }
  return null;
}

/** Why the module is over the compressed ceiling, or `null`. Our side of the
 *  comparison is the estimate, not Cloudflare's number: it compresses
 *  server-side with an unpublished algorithm, so level-6 gzip is a proxy for
 *  the figure it measures. The cap carries the margin. */
export function workerGzipCapBreach(
  gzipBytes: number,
  gzipCapBytes: number,
): string | null {
  if (gzipBytes > gzipCapBytes) {
    return (
      `bundled module is ${gzipBytes} bytes gzipped (level ${BUNDLE_GZIP_LEVEL}), ` +
      `over the ${gzipCapBytes}-byte cap for a Cloudflare Worker script`
    );
  }
  return null;
}

/** Measure a module and say whether it breaches either ceiling. Never throws:
 *  what a breach costs depends on whether the caller can re-partition, and only
 *  the caller knows that. */
export async function judgeBundleSize(
  module: string,
  gzipCapBytes: number,
): Promise<SizeVerdict> {
  const { rawBytes, gzipBytes } = await measureBundleBytes(module);
  // Uncompressed first: it is the exact one, so when both are over it is the
  // verdict worth reporting.
  const breach =
    workerRawSizeBreach(rawBytes) ??
    workerGzipCapBreach(gzipBytes, gzipCapBytes);
  return { rawBytes, gzipBytes, breach };
}
