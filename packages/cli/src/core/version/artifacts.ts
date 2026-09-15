import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { globby } from "globby";
import pMap from "p-map";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";
import type { ArtifactFile, ArtifactSet } from "@/core/version/schema.js";

/** The same ceiling the site collector applies; one build, one limit. */
const MAX_FILE_COUNT = 100_000;

/** Open descriptors while hashing. Well under the 256 a production Node keeps. */
const HASH_CONCURRENCY = 32;

const ASSETS_IGNORE_FILE = ".assetsignore";

/** Never part of a frontend, whatever `.assetsignore` says. */
const ALWAYS_IGNORED = new Set([
  ASSETS_IGNORE_FILE,
  "wrangler.json",
  ".dev.vars",
]);

/** The platform refuses a set without it; failing here saves the upload. */
const ENTRY = "index.html";

/**
 * Full sha256 over a file's bytes, streamed. Deliberately not `hashAsset` — see
 * {@link ArtifactFile.digest}.
 */
async function digestFile(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Walk a build's output directory and describe every file in it. Honors
 * `.assetsignore` by the same rules the site collector uses, so the two lanes
 * cannot disagree about what a build produced.
 */
export async function collectBuildOutput(
  outputDir: string,
): Promise<ArtifactFile[]> {
  // globby returns forward-slash paths on every platform, which is how the
  // version keys them. Never pass `ignore` alongside `ignoreFiles`: globby globs
  // for ignore files using that option, so it would find none and silently apply
  // no patterns — hence the filter below.
  const found = await globby("**/*", {
    cwd: outputDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignoreFiles: [ASSETS_IGNORE_FILE],
  });
  const relativePaths = found
    .filter((path) => !ALWAYS_IGNORED.has(basename(path)))
    .sort();

  if (relativePaths.length === 0) {
    throw new InvalidInputError(
      `No files found in ${outputDir}. Build the site before creating a version.`,
      {
        hints: [
          { message: "Run 'base44 build' first", command: "base44 build" },
        ],
      },
    );
  }
  if (relativePaths.length > MAX_FILE_COUNT) {
    throw new InvalidInputError(
      `Too many files: found ${relativePaths.length}, the limit is ${MAX_FILE_COUNT}.`,
    );
  }
  if (!relativePaths.includes(ENTRY)) {
    throw new InvalidInputError(
      `${outputDir} has no ${ENTRY}, so nothing could enter the site.`,
    );
  }

  // Bounded: one open descriptor per file, and the advertised ceiling is 100k.
  // An unbounded Promise.all hits EMFILE at ~1.5k on a default descriptor limit,
  // long before any of the declared limits.
  return await pMap(
    relativePaths,
    async (path) => {
      const absolutePath = join(outputDir, ...path.split("/"));
      const { size } = await stat(absolutePath);
      return {
        path,
        absolutePath,
        size,
        digest: await digestFile(absolutePath),
      };
    },
    { concurrency: HASH_CONCURRENCY },
  );
}

/**
 * The app's declared entities and agents, raw.
 *
 * Not the validated resource readers: the platform's extractor is authoritative,
 * and this CLI's stricter entity schema refuses real Builder apps — which is why
 * `site deploy` reads no resources at all.
 *
 * Keyed by path with the schema extension stripped, the name the platform
 * derives from the same file, so `agents/support/triage.jsonc` is `support/triage`.
 */
async function readRawResources(dir: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(dir))) {
    return {};
  }
  const files = await globby(`**/*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: dir,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  const payloads: Record<string, unknown> = {};
  for (const relativePath of files.sort()) {
    const name = relativePath.replace(/\.jsonc?$/, "");
    payloads[name] = await readJsonFile(join(dir, ...relativePath.split("/")));
  }
  return payloads;
}

export async function collectResources(
  configDir: string,
  dirs: { entitiesDir: string; agentsDir: string },
): Promise<Pick<ArtifactSet, "entities" | "agents">> {
  const [entities, agents] = await Promise.all([
    readRawResources(join(configDir, dirs.entitiesDir)),
    readRawResources(join(configDir, dirs.agentsDir)),
  ]);
  return { entities, agents };
}
