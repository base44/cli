import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { globby } from "globby";
import pMap from "p-map";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import { resolveFullStackBuild } from "@/core/site/full-stack.js";
import { describeBuildOutput, hashFileInto } from "@/core/site/manifest.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";
import type {
  ArtifactFile,
  ArtifactSet,
  SiteWorkerArtifact,
} from "@/core/version/schema.js";

/**
 * What one declaration may cost the platform: a presigned URL per file, and the
 * whole set held in Redis until it finalizes. ~2x the largest frontend ever
 * measured through the build sandbox (25.5k assets). Must match the server's
 * ceiling — declaring more only earns a rejection after the walk.
 */
const MAX_FILE_COUNT = 50_000;

/** Open descriptors while hashing. Well under the 256 a production Node keeps. */
const HASH_CONCURRENCY = 32;

/**
 * The entry file the platform serves for any unmatched path — but only when the
 * platform is what serves. A Worker's own asset settings decide that instead,
 * so a full-stack build is not required to have one.
 */
const ENTRY = "index.html";

/**
 * Full sha256 over a file's bytes, streamed. Deliberately not `hashAsset` — see
 * {@link ArtifactFile.digest}.
 */
async function digestFile(absolutePath: string): Promise<string> {
  const hash = await hashFileInto(createHash("sha256"), absolutePath);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Walk a build's output directory and describe every file in it. Honors
 * `.assetsignore` by the same rules the site collector uses, so the two lanes
 * cannot disagree about what a build produced.
 */
export async function collectBuildOutput(
  outputDir: string,
  options: { requireEntry?: boolean } = {},
): Promise<ArtifactFile[]> {
  const found = await describeBuildOutput(outputDir);

  if (found.length === 0) {
    throw new InvalidInputError(
      `No files found in ${outputDir}. Build the site before creating a version.`,
      {
        hints: [
          { message: "Run 'base44 build' first", command: "base44 build" },
        ],
      },
    );
  }
  if (found.length > MAX_FILE_COUNT) {
    throw new InvalidInputError(
      `Too many files: found ${found.length}, the limit is ${MAX_FILE_COUNT}.`,
    );
  }
  if (options.requireEntry !== false && !found.some((f) => f.path === ENTRY)) {
    throw new InvalidInputError(
      `${outputDir} has no ${ENTRY}, so nothing could enter the site.`,
    );
  }

  // Bounded: one open descriptor per file, and the advertised ceiling is 50k.
  // An unbounded Promise.all hits EMFILE at ~1.5k on a default descriptor limit,
  // long before any of the declared limits.
  return await pMap(
    found,
    async (file) => ({ ...file, digest: await digestFile(file.absolutePath) }),
    { concurrency: HASH_CONCURRENCY },
  );
}

/**
 * The app's own server, when the framework built one — otherwise `null`.
 *
 * Reads through {@link resolveFullStackBuild}, the same call the deploy lane
 * makes, and only then differs: this lane hashes the modules into artifacts
 * where that one shapes them into a Cloudflare config. What the framework built
 * is one answer, given once.
 */
export async function collectSiteWorker(
  projectRoot: string,
): Promise<SiteWorkerArtifact | null> {
  const built = await resolveFullStackBuild(projectRoot);
  if (!built) {
    return null;
  }

  const { config, modules, assetsDir } = built;
  // By identity, not by position: the platform matches the entry against the
  // module NAMES it was sent, and `main` in the config may still carry a "./".
  const entry = resolve(config.configDir, config.main);
  const main = modules.find((m) => m.absolutePath === entry)?.name;
  if (!main) {
    throw new InvalidInputError(
      `The Worker's entry module ${config.main} is not among the ${modules.length} modules collected from ${config.configDir}.`,
    );
  }

  return {
    main,
    modules: await pMap(
      modules,
      async ({ name, absolutePath, size }) => ({
        path: name,
        absolutePath,
        size,
        digest: await digestFile(absolutePath),
      }),
      { concurrency: HASH_CONCURRENCY },
    ),
    compatibilityDate: config.compatibilityDate,
    compatibilityFlags: config.compatibilityFlags,
    assetsDir,
  };
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
