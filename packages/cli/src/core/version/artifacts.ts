import { join, resolve } from "node:path";
import { globby } from "globby";
import pMap from "p-map";
import {
  CONFIG_FILE_EXTENSION,
  CONFIG_FILE_EXTENSION_GLOB,
} from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import type { BuildTarget } from "@/core/project/target.js";
import type { FullStackBuild } from "@/core/site/full-stack.js";
import { resolveFullStackBuild } from "@/core/site/full-stack.js";
import { describeBuildOutput } from "@/core/site/manifest.js";
import { pathExists, readJsonFile, readTextFile } from "@/core/utils/fs.js";
import { compileActors } from "@/core/version/actors.js";
import { digestFile } from "@/core/version/digest.js";
import { compileBackendBundles } from "@/core/version/functions.js";
import { tagStep } from "@/core/version/publish.js";
import { collectRoutes } from "@/core/version/routes.js";
import type {
  ArtifactFile,
  ArtifactSet,
  SiteWorkerArtifact,
} from "@/core/version/schema.js";
import {
  collectSourceMaps,
  isInsideSourceMaps,
} from "@/core/version/source-maps.js";

/** Must match the server's ceiling: declaring more only earns a late rejection. */
const MAX_FILE_COUNT = 50_000;

/** One open descriptor per file in flight; an unbounded fan-out hits EMFILE. */
const HASH_CONCURRENCY = 32;

/** Served for any unmatched path — but only when the platform is what serves. */
const ENTRY = "index.html";

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
  options: {
    entryFile?: string;
    /** Left out before anything is counted or hashed. */
    exclude?: (absolutePath: string) => boolean;
  } = {},
): Promise<ArtifactFile[]> {
  const { exclude } = options;
  const walked = await describeBuildOutput(outputDir);
  const found = exclude
    ? walked.filter((file) => !exclude(file.absolutePath))
    : walked;

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

/**
 * The app's workflow files, keyed by file name without `.jsonc`, the way the
 * platform reads the same directory: only `.jsonc` directly in it is a workflow
 * (a `.json` file or a nested one is an ordinary file), and a dot-file counts
 * (`.draft.jsonc` is the workflow `.draft`). Parsed and sent as written.
 */
async function readWorkflowFiles(
  dir: string,
): Promise<Record<string, unknown>> {
  if (!(await pathExists(dir))) {
    return {};
  }
  const files = await globby(`*.${CONFIG_FILE_EXTENSION}`, {
    cwd: dir,
    onlyFiles: true,
    followSymbolicLinks: false,
    dot: true,
  });
  const workflows: Record<string, unknown> = {};
  for (const file of files.sort()) {
    workflows[file.slice(0, -`.${CONFIG_FILE_EXTENSION}`.length)] =
      await readJsonFile(join(dir, file));
  }
  return workflows;
}

/**
 * The app's MCP config as written, `""` when it has none. Text rather than parsed:
 * the platform reads this file as strict JSON, and the JSON5 reader above would
 * accept a file the platform reads as no config at all.
 */
async function readMcpConfig(configDir: string): Promise<string> {
  const path = join(configDir, "mcp", "config.json");
  return (await pathExists(path)) ? await readTextFile(path) : "";
}

/**
 * Each agent skill file as written, keyed by skill name: `agent-skills/triage.md` is
 * `triage`. Text rather than parsed, like the MCP config: the platform's reader
 * decides what a skill file says, and this CLI's would sometimes read it differently.
 * Only the folder's own `*.md` files are skills.
 */
async function readAgentSkillFiles(
  dir: string,
): Promise<Record<string, string>> {
  if (!(await pathExists(dir))) {
    return {};
  }
  const files = await globby("*.md", {
    cwd: dir,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  const skills: Record<string, string> = {};
  for (const file of files.sort()) {
    skills[file.replace(/\.md$/, "")] = await readTextFile(join(dir, file));
  }
  return skills;
}

/**
 * Each email template as written, keyed by its name: `emails/Welcome.html` is
 * `Welcome`. Text rather than parsed: the platform compiles MJML and bounds the
 * size. Only the folder's own `*.html` files are templates, and the folder is
 * fixed, like the MCP config's, because it is the one the platform reads.
 */
async function readEmailFiles(
  configDir: string,
): Promise<Record<string, string>> {
  const dir = join(configDir, "emails");
  if (!(await pathExists(dir))) {
    return {};
  }
  const files = await globby("*.html", {
    cwd: dir,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  const emails: Record<string, string> = {};
  for (const file of files.sort()) {
    emails[file.replace(/\.html$/, "")] = await readTextFile(join(dir, file));
  }
  return emails;
}

export async function collectResources(
  configDir: string,
  dirs: {
    entitiesDir: string;
    agentsDir: string;
    agentSkillsDir: string;
    workflowsDir: string;
  },
): Promise<
  Pick<
    ArtifactSet,
    "entities" | "agents" | "mcpConfig" | "agentSkills" | "emails" | "workflows"
  >
> {
  const [entities, agents, mcpConfig, agentSkills, emails, workflows] =
    await Promise.all([
      readRawResources(join(configDir, dirs.entitiesDir)),
      readRawResources(join(configDir, dirs.agentsDir)),
      readMcpConfig(configDir),
      readAgentSkillFiles(join(configDir, dirs.agentSkillsDir)),
      readEmailFiles(configDir),
      readWorkflowFiles(join(configDir, dirs.workflowsDir)),
    ]);
  return { entities, agents, mcpConfig, agentSkills, emails, workflows };
}

/**
 * Everything one build produced, ready to declare.
 *
 * One reader, so `publish` and `versions create` cannot disagree about what a
 * build left behind — a second would eventually declare a Worker's own files as
 * a static bundle, which is the one thing the platform reads as "serve from S3".
 *
 * `onWarning` hears what was left out rather than failing the build: a source
 * map is never a reason not to publish.
 */
export async function collectArtifacts(
  target: BuildTarget,
  options: { routesFile?: string; onWarning?: (message: string) => void } = {},
): Promise<ArtifactSet> {
  const built = await resolveFullStackBuild(target.root);
  const siteWorker = built ? await describeSiteWorker(built) : null;
  const routes = await collectRoutes(target.root, options.routesFile);
  // Private maps are never assets, even when an output folder that is the
  // project root walks straight into them — and are left out before the walk
  // is counted or hashed, so they cannot push a build past the file limit.
  const exclude = (absolutePath: string) =>
    isInsideSourceMaps(target.root, absolutePath);
  // One set, from wherever this build put it. The entry rule applies only
  // when the PLATFORM serves it: a Worker's own asset settings answer an
  // unmatched path, and a Worker that serves nothing is a complete app.
  const assets = built
    ? built.assetsDir
      ? await collectBuildOutput(built.assetsDir, { exclude })
      : []
    : await collectBuildOutput(target.outputDir, {
        entryFile: ENTRY,
        exclude,
      });
  const sourceMaps = await collectSourceMaps(target.root, assets, {
    onWarning: options.onWarning,
  });
  return {
    assets,
    ...(siteWorker ? { siteWorker } : {}),
    // Compiled here, not by `base44 build`: `--no-build` skips only the site's
    // own build command, and a version without its functions would remove them.
    backendBundles: await tagStep("build", () =>
      compileBackendBundles(
        target.root,
        join(target.configDir, target.functionsDir),
      ),
    ),
    actors: await tagStep("build", () =>
      compileActors(join(target.configDir, target.actorsDir)),
    ),
    ...(await collectResources(target.configDir, target)),
    ...(routes ? { routes } : {}),
    ...(sourceMaps ? { sourceMaps } : {}),
  };
}
