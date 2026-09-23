import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { globby } from "globby";
import pMap from "p-map";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import type { BuildTarget } from "@/core/project/target.js";
import { requireOutputDir } from "@/core/project/target.js";
import type { FullStackBuild } from "@/core/site/full-stack.js";
import { resolveFullStackBuild } from "@/core/site/full-stack.js";
import { describeBuildOutput, hashFileInto } from "@/core/site/manifest.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";
import type {
  ArtifactFile,
  ArtifactSet,
  SiteWorkerArtifact,
} from "@/core/version/schema.js";

/** Must match the server's ceiling: declaring more only earns a late rejection. */
const MAX_FILE_COUNT = 50_000;

/** One open descriptor per file in flight; an unbounded fan-out hits EMFILE. */
const HASH_CONCURRENCY = 32;

/** Served for any unmatched path — but only when the platform is what serves. */
const ENTRY = "index.html";

/** Deliberately not `hashAsset` — see {@link ArtifactFile.digest}. */
async function digestFile(absolutePath: string): Promise<string> {
  const hash = await hashFileInto(createHash("sha256"), absolutePath);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Every file a build emitted, addressed and hashed. An empty directory is an
 * empty set, not an error: a Worker that answers every path itself is a complete
 * app whose assets directory exists and holds nothing.
 *
 * `entryFile` is the caller saying this set must be ENTERABLE, which is one
 * rule, not two — a set nothing can enter is as broken empty as it is without
 * its entry, and the platform is what serves it.
 */
export async function collectBuildOutput(
  outputDir: string,
  options: { entryFile?: string } = {},
): Promise<ArtifactFile[]> {
  const found = await describeBuildOutput(outputDir);

  if (found.length > MAX_FILE_COUNT) {
    throw new InvalidInputError(
      `Too many files: found ${found.length}, the limit is ${MAX_FILE_COUNT}.`,
    );
  }
  if (options.entryFile) {
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
    if (!found.some((f) => f.path === options.entryFile)) {
      throw new InvalidInputError(
        `${outputDir} has no ${options.entryFile}, so nothing could enter the site.`,
      );
    }
  }

  // Bounded: an unbounded Promise.all hits EMFILE at ~1.5k open descriptors.
  return await pMap(
    found,
    async (file) => ({ ...file, digest: await digestFile(file.absolutePath) }),
    { concurrency: HASH_CONCURRENCY },
  );
}

/**
 * The app's own server, when the framework built one — otherwise `null`. Reads
 * through {@link resolveFullStackBuild}, the same call the deploy lane makes.
 */
export async function collectSiteWorker(
  projectRoot: string,
): Promise<SiteWorkerArtifact | null> {
  const built = await resolveFullStackBuild(projectRoot);
  return built ? await describeSiteWorker(built) : null;
}

/**
 * The same description from a build already resolved — so `collectArtifacts`,
 * which needs the assets directory too, reads the wrangler config ONCE. A second
 * read is a second opinion about what the framework built.
 */
async function describeSiteWorker(
  built: FullStackBuild,
): Promise<SiteWorkerArtifact> {
  const { config, modules } = built;
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
      async ({ name, absolutePath, size, type }) => ({
        path: name,
        absolutePath,
        size,
        digest: await digestFile(absolutePath),
        // Carried, not re-derived: the rules that decided it are the wrangler
        // config's, and a second guess from the extension would disagree.
        type,
      }),
      { concurrency: HASH_CONCURRENCY },
    ),
    compatibilityDate: config.compatibilityDate,
    compatibilityFlags: config.compatibilityFlags,
    // Read from wrangler's `assets` block, recorded under what it decides.
    servingConfig: config.assetsConfig,
  };
}

/**
 * The app's declared entities and agents, raw — deliberately not the validated
 * resource readers, whose stricter entity schema refuses real Builder apps.
 *
 * Keyed the way the platform names the same file: `agents/support/triage.jsonc`
 * is `support/triage`.
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

/**
 * Everything one build produced, ready to declare.
 *
 * One reader, so `publish` and `versions create` cannot disagree about what a
 * build left behind — a second would eventually declare a Worker's own files as
 * a static bundle, which is the one thing the platform reads as "serve from S3".
 */
export async function collectArtifacts(
  target: BuildTarget,
): Promise<ArtifactSet> {
  const built = await resolveFullStackBuild(target.root);
  const siteWorker = built ? await describeSiteWorker(built) : null;
  return {
    // One set, from wherever this build put it. The entry rule applies only
    // when the PLATFORM serves it: a Worker's own asset settings answer an
    // unmatched path, and a Worker that serves nothing is a complete app.
    assets: built
      ? built.assetsDir
        ? await collectBuildOutput(built.assetsDir)
        : []
      : await collectBuildOutput(requireOutputDir(target), {
          entryFile: ENTRY,
        }),
    ...(siteWorker ? { siteWorker } : {}),
    ...(await collectResources(target.configDir, target)),
  };
}
