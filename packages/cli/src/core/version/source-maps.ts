import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep, win32 } from "node:path";
import pMap from "p-map";
import { z } from "zod";
import { pathExists } from "@/core/utils/fs.js";
import { digestFile } from "@/core/version/digest.js";
import type { ArtifactFile, SourceMapArtifact } from "@/core/version/schema.js";

/**
 * Where `@base44/vite-plugin` leaves a build's private source maps: at the
 * project root, beside the output folder and never inside it, so nothing that
 * does not know about them uploads or serves them.
 */
const SOURCE_MAPS_DIR = join(".base44", "source-maps");
const MANIFEST_FILE = "manifest.json";

/** Bounded like the asset hashing: one open descriptor per map in flight. */
const HASH_CONCURRENCY = 32;

/**
 * Only the shape is checked here; each entry is checked on its own below, so one
 * bad entry costs that map rather than the whole manifest.
 */
const ManifestSchema = z.object({
  version: z.literal(1),
  maps: z.array(z.unknown()),
});

const EntrySchema = z.object({
  file: z.string(),
  bundle: z.string(),
});

/**
 * Forward slashes, no leading "/", no drive, and no segment that is empty, "."
 * or "..": the platform reads `bundle` as an asset path, and a `file` that could
 * climb out of the source-maps folder could name any file on the machine.
 */
function isPlainRelativePath(path: string): boolean {
  if (
    path === "" ||
    path.includes("\\") ||
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[A-Za-z]:/.test(path)
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function sourceMapsDir(projectRoot: string): string {
  return join(projectRoot, SOURCE_MAPS_DIR);
}

/** Whether a file is one of the private maps — which is never an asset. */
export function isInsideSourceMaps(
  projectRoot: string,
  absolutePath: string,
): boolean {
  const rel = relative(sourceMapsDir(projectRoot), absolutePath);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

/**
 * The build's private source maps, ready to declare — or `undefined` when there
 * are none to declare, so the declaration carries no `source_maps` at all. That
 * matters: the platform's request models forbid unknown fields, so a field this
 * CLI sent to a platform that predates it would refuse the whole version.
 *
 * Nothing here fails a publish. A manifest that cannot be read, or an entry that
 * names a file outside the folder or an asset the build did not emit, is left
 * out with a warning; the app is the same app with or without its maps.
 */
export async function collectSourceMaps(
  projectRoot: string,
  assets: ArtifactFile[],
  options: { onWarning?: (message: string) => void } = {},
): Promise<SourceMapArtifact[] | undefined> {
  const warn = options.onWarning ?? (() => {});
  const dir = sourceMapsDir(projectRoot);
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!(await pathExists(manifestPath))) {
    return undefined;
  }

  const manifestName = posix.join(".base44", "source-maps", MANIFEST_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (error) {
    warn(
      `Skipping source maps: ${manifestName} is not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
    return undefined;
  }
  const manifest = ManifestSchema.safeParse(parsed);
  if (!manifest.success) {
    warn(
      `Skipping source maps: ${manifestName} is not a version 1 source-map manifest.`,
    );
    return undefined;
  }

  const assetPaths = new Set(assets.map((asset) => asset.path));
  const seenBundles = new Set<string>();
  const accepted: Omit<SourceMapArtifact, "digest">[] = [];

  for (const [index, raw] of manifest.data.maps.entries()) {
    const entry = EntrySchema.safeParse(raw);
    if (!entry.success) {
      warn(
        `Skipping source map ${index} in ${manifestName}: it needs a "file" and a "bundle".`,
      );
      continue;
    }
    const { file, bundle } = entry.data;
    if (!isPlainRelativePath(file)) {
      warn(
        `Skipping source map ${file}: its path must be relative to .base44/source-maps/, with no "..".`,
      );
      continue;
    }
    if (!isPlainRelativePath(bundle) || !assetPaths.has(bundle)) {
      warn(
        `Skipping source map ${file}: its bundle ${bundle} is not a file this build declares.`,
      );
      continue;
    }
    if (seenBundles.has(bundle)) {
      warn(
        `Skipping source map ${file}: another map in ${manifestName} already names ${bundle}.`,
      );
      continue;
    }
    const absolutePath = join(dir, ...file.split("/"));
    // Not followed: a link is how a well-formed path would still reach a file
    // outside the folder.
    const stats = await lstat(absolutePath).catch(() => null);
    if (!stats?.isFile()) {
      warn(
        `Skipping source map ${file}: no such file in .base44/source-maps/.`,
      );
      continue;
    }
    seenBundles.add(bundle);
    accepted.push({ bundle, file, absolutePath, size: stats.size });
  }

  if (accepted.length === 0) {
    return undefined;
  }
  return await pMap(
    accepted,
    async (map) => ({ ...map, digest: await digestFile(map.absolutePath) }),
    { concurrency: HASH_CONCURRENCY },
  );
}
