import type { Hash } from "node:crypto";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { globby } from "globby";
import pMap from "p-map";
import { InvalidInputError } from "@/core/errors.js";
import type {
  AssetFile,
  AssetManifestEntry,
  AssetManifestResult,
} from "./schema.js";

const MAX_ASSET_COUNT = 100_000;

const ASSETS_IGNORE_FILE = ".assetsignore";

/** Files never uploaded as assets, regardless of .assetsignore. */
const ALWAYS_IGNORED = new Set([
  ASSETS_IGNORE_FILE,
  "wrangler.json",
  ".dev.vars",
]);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

/** Only the cf arm reads this; the s3 arm echoes the signed Content-Type. */
function getAssetContentType(filePath: string): string {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

/**
 * First 32 hex chars of sha256(utf8(app_id) || raw file bytes). The app-id salt
 * means a tenant can only collide with their own files, so a malicious upload
 * cannot poison another app's asset cache.
 */
/**
 * Every file a build emitted, sorted. One rule for both lanes: `.assetsignore`
 * with full gitignore semantics, plus the names no build ever ships.
 */
async function walkBuildOutput(outputDir: string): Promise<string[]> {
  // globby returns forward-slash paths on every platform. Never pass `ignore`
  // alongside `ignoreFiles`: globby globs for ignore files using that option, so
  // it would find none and silently apply no patterns — hence the filter below.
  const found = await globby("**/*", {
    cwd: outputDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignoreFiles: [ASSETS_IGNORE_FILE],
  });
  return found.filter((path) => !ALWAYS_IGNORED.has(basename(path))).sort();
}

/** One file a build emitted, located and sized. What names it is the caller's. */
interface BuildFile {
  /** Build-relative, forward slashes, no leading "/". */
  path: string;
  absolutePath: string;
  size: number;
}

/** Open descriptors while walking. Well under the 256 a production Node keeps. */
const STAT_CONCURRENCY = 32;

/**
 * Every file {@link walkBuildOutput} found, located and sized. No hash: the two
 * lanes' hashes are different values and must never become one.
 */
export async function describeBuildOutput(
  outputDir: string,
): Promise<BuildFile[]> {
  const relativePaths = await walkBuildOutput(outputDir);
  return await pMap(
    relativePaths,
    async (path) => {
      const absolutePath = join(outputDir, ...path.split("/"));
      return { path, absolutePath, size: (await stat(absolutePath)).size };
    },
    { concurrency: STAT_CONCURRENCY },
  );
}

/** Stream a file through a hash, so a large one never lands in memory whole. */
export async function hashFileInto(
  hash: Hash,
  absolutePath: string,
): Promise<Hash> {
  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk);
  }
  return hash;
}

export function hashAsset(appId: string, content: Buffer): string {
  return createHash("sha256")
    .update(Buffer.from(appId, "utf8"))
    .update(content)
    .digest("hex")
    .slice(0, 32);
}

/**
 * {@link hashAsset} over a file, read in chunks in order to support large files
 * without reading them entirely to memory.
 */
async function hashAssetFile(
  appId: string,
  absolutePath: string,
): Promise<string> {
  const hash = await hashFileInto(
    createHash("sha256").update(Buffer.from(appId, "utf8")),
    absolutePath,
  );
  return hash.digest("hex").slice(0, 32);
}

/**
 * Walk the assets directory and build the deployment asset manifest. Honors
 * `.assetsignore` at the assets root with full gitignore semantics, negation
 * included. Caps the total file count at 100,000; there is no per-file size
 * limit — files are hashed in chunks, never read whole.
 */
export async function buildAssetManifest(
  assetsDir: string,
  appId: string,
): Promise<AssetManifestResult> {
  const manifest: Record<string, AssetManifestEntry> = {};
  const filesByHash = new Map<string, AssetFile>();

  const files = await describeBuildOutput(assetsDir);

  if (files.length > MAX_ASSET_COUNT) {
    throw new InvalidInputError(
      `Too many static assets: found ${files.length}, the limit is ${MAX_ASSET_COUNT} files.`,
    );
  }

  for (const { path: relativePath, absolutePath, size } of files) {
    const hash = await hashAssetFile(appId, absolutePath);

    manifest[`/${relativePath}`] = { hash, size };
    if (!filesByHash.has(hash)) {
      filesByHash.set(hash, {
        absolutePath,
        hash,
        size,
        contentType: getAssetContentType(absolutePath),
      });
    }
  }

  return { manifest, filesByHash };
}
