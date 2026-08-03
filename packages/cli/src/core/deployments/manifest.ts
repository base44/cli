import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { pathExists, readTextFile } from "@/core/utils/fs.js";
import type {
  AssetFile,
  AssetManifestEntry,
  AssetManifestResult,
} from "./schema.js";

const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB
const MAX_ASSET_COUNT = 100_000;

const ASSETS_IGNORE_FILE = ".assetsignore";

/** Files never uploaded as assets, regardless of .assetsignore. */
const ALWAYS_SKIPPED_FILES = new Set([
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

/**
 * Content type for a cf-arm multipart upload part. The s3 arm never uses
 * this — there the server signs each Content-Type into the presigned URL
 * and the CLI echoes it verbatim.
 */
function getAssetContentType(filePath: string): string {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

/**
 * Content-addressed asset hash: first 32 hex chars of
 * sha256(utf8(app_id) || raw file bytes). Salting with the app id means a
 * tenant can only produce hash collisions with their own files, so a
 * malicious upload cannot poison another app's asset cache.
 */
export function hashAsset(appId: string, content: Buffer): string {
  return createHash("sha256")
    .update(Buffer.from(appId, "utf8"))
    .update(content)
    .digest("hex")
    .slice(0, 32);
}

type IgnoreMatcher = (relativePath: string, isDirectory: boolean) => boolean;

function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i++;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Minimal gitignore-style matcher for .assetsignore. Supports exact names,
 * `*`/`**` globs, directory patterns (trailing `/`), and root-anchored
 * patterns (containing `/`). Negation (`!`) is not supported.
 */
function createIgnoreMatcher(lines: string[]): IgnoreMatcher {
  const rules = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const isDirOnly = line.endsWith("/");
      let pattern = isDirOnly ? line.slice(0, -1) : line;
      const anchored = pattern.includes("/");
      pattern = pattern.replace(/^\//, "");
      return { regex: globToRegExp(pattern), anchored, isDirOnly };
    });

  return (relativePath, isDirectory) => {
    const segments = relativePath.split("/");
    return rules.some((rule) => {
      if (rule.anchored) {
        if (rule.isDirOnly ? isDirectory : true) {
          if (rule.regex.test(relativePath)) return true;
        }
        // A directory pattern also ignores everything under the directory;
        // matching directories are pruned during the walk.
        return false;
      }
      // Unanchored: match the basename (and for dir-only rules, any segment —
      // but directories are pruned during the walk, so files only need their
      // own basename checked).
      const basename = segments[segments.length - 1];
      if (rule.isDirOnly && !isDirectory) return false;
      return rule.regex.test(basename);
    });
  };
}

async function loadIgnoreMatcher(assetsDir: string): Promise<IgnoreMatcher> {
  const ignorePath = join(assetsDir, ASSETS_IGNORE_FILE);
  if (!(await pathExists(ignorePath))) {
    return () => false;
  }
  const content = await readTextFile(ignorePath);
  return createIgnoreMatcher(content.split(/\r?\n/));
}

/**
 * Walk the assets directory and build the deployment asset manifest.
 * Honors `.assetsignore` at the assets root, always skips `.assetsignore`,
 * `wrangler.json`, and `.dev.vars`, rejects files larger than 25 MiB, and
 * caps the total file count at 100,000.
 */
export async function buildAssetManifest(
  assetsDir: string,
  appId: string,
): Promise<AssetManifestResult> {
  const isIgnored = await loadIgnoreMatcher(assetsDir);
  const manifest: Record<string, AssetManifestEntry> = {};
  const filesByHash = new Map<string, AssetFile>();

  const relativeFilePaths = await collectFilePaths(assetsDir, "", isIgnored);

  if (relativeFilePaths.length > MAX_ASSET_COUNT) {
    throw new InvalidInputError(
      `Too many static assets: found ${relativeFilePaths.length}, the limit is ${MAX_ASSET_COUNT} files.`,
    );
  }

  for (const relativePath of relativeFilePaths.sort()) {
    const absolutePath = join(assetsDir, ...relativePath.split("/"));
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

async function collectFilePaths(
  dir: string,
  relativeDir: string,
  isIgnored: IgnoreMatcher,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      if (isIgnored(relativePath, true)) continue;
      results.push(
        ...(await collectFilePaths(
          join(dir, entry.name),
          relativePath,
          isIgnored,
        )),
      );
      continue;
    }

    if (!entry.isFile()) continue;
    if (ALWAYS_SKIPPED_FILES.has(entry.name)) continue;
    if (isIgnored(relativePath, false)) continue;

    results.push(relativePath);
  }

  return results;
}
