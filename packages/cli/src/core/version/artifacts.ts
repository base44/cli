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

/** Must match the server's ceiling: declaring more only earns a late rejection. */
const MAX_FILE_COUNT = 50_000;

/** Open descriptors while hashing. Well under the 256 a production Node keeps. */
const HASH_CONCURRENCY = 32;

/** Served for any unmatched path — but only when the platform is what serves. */
const ENTRY = "index.html";

/** Deliberately not `hashAsset` — see {@link ArtifactFile.digest}. */
async function digestFile(absolutePath: string): Promise<string> {
  const hash = await hashFileInto(createHash("sha256"), absolutePath);
  return `sha256:${hash.digest("hex")}`;
}

/** Every file a build emitted, addressed and hashed. */
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
    // No entry rule: the Worker's own asset settings answer an unmatched path.
    assets: assetsDir
      ? await collectBuildOutput(assetsDir, { requireEntry: false })
      : [],
    compatibilityDate: config.compatibilityDate,
    compatibilityFlags: config.compatibilityFlags,
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
