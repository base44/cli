import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { globby } from "globby";
import { InvalidInputError } from "@/core/errors.js";
import type {
  AssetFile,
  AssetManifestEntry,
  AssetManifestResult,
} from "./schema.js";

const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB
const MAX_ASSET_COUNT = 100_000;

const ASSETS_IGNORE_FILE = ".assetsignore";

/** Files never uploaded as assets, regardless of .assetsignore. */
const ALWAYS_IGNORED = new Set([
  ASSETS_IGNORE_FILE,
  "wrangler.json",
  ".dev.vars",
]);

/**
 * First 32 hex chars of sha256(utf8(app_id) || raw file bytes). The app-id salt
 * means a tenant can only collide with their own files, so a malicious upload
 * cannot poison another app's asset cache.
 */
export function hashAsset(appId: string, content: Buffer): string {
  return createHash("sha256")
    .update(Buffer.from(appId, "utf8"))
    .update(content)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Walk the assets directory and build the deployment asset manifest. Honors
 * `.assetsignore` at the assets root with full gitignore semantics, negation
 * included.
 */
export async function buildAssetManifest(
  assetsDir: string,
  appId: string,
): Promise<AssetManifestResult> {
  const manifest: Record<string, AssetManifestEntry> = {};
  const filesByHash = new Map<string, AssetFile>();

  // globby returns forward-slash paths on every platform, which is how the
  // manifest keys them. Never pass `ignore` alongside `ignoreFiles`: globby
  // globs for ignore files using that option, so it would find none and
  // silently apply no patterns — hence the filter below.
  const found = await globby("**/*", {
    cwd: assetsDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignoreFiles: [ASSETS_IGNORE_FILE],
  });
  const relativeFilePaths = found.filter(
    (path) => !ALWAYS_IGNORED.has(basename(path)),
  );

  if (relativeFilePaths.length > MAX_ASSET_COUNT) {
    throw new InvalidInputError(
      `Too many static assets: found ${relativeFilePaths.length}, the limit is ${MAX_ASSET_COUNT} files.`,
    );
  }

  for (const relativePath of relativeFilePaths.sort()) {
    const absolutePath = join(assetsDir, ...relativePath.split("/"));
    // Stat before read so an oversized file is never pulled into memory.
    const { size } = await stat(absolutePath);
    if (size > MAX_ASSET_SIZE_BYTES) {
      throw new InvalidInputError(
        `Static asset "${relativePath}" is ${size} bytes, which exceeds the 25 MiB per-file limit.`,
      );
    }

    const content = await readFile(absolutePath);
    const hash = hashAsset(appId, content);

    manifest[`/${relativePath}`] = { hash, size };
    if (!filesByHash.has(hash)) {
      filesByHash.set(hash, { absolutePath, hash, size });
    }
  }

  return { manifest, filesByHash };
}
