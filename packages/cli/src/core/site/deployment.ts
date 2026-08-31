import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import { pathExists } from "@/core/utils/fs.js";
import { createDeployment, finalizeDeployment } from "./api.js";
import { buildAssetManifest } from "./manifest.js";
import { collectModules } from "./modules.js";
import type {
  AssetManifestResult,
  CreateDeploymentRequest,
  DeploymentProgress,
  WorkerModule,
} from "./schema.js";
import { uploadDeploymentAssets } from "./upload.js";
import type { ResolvedWranglerConfig } from "./wrangler-config.js";
import {
  detectFullStackArtifact,
  resolveWranglerConfig,
} from "./wrangler-config.js";

type WorkerConfig = NonNullable<CreateDeploymentRequest["config"]>;

interface WorkerBuild {
  config: WorkerConfig;
  modules: WorkerModule[];
  /** The worker's own assets directory, which supersedes site.outputDirectory. */
  assetsDir: string | null;
}

/** What completes the deployment at finalize. */
type Completion = { modules: WorkerModule[] } | { indexHtml: Uint8Array };

const NO_ASSETS: AssetManifestResult = { manifest: {}, filesByHash: new Map() };

const DEPLOYMENTS_API_ENV = "BASE44_DEPLOYMENTS_API";

/**
 * Internal gate for the deployments-API lane — static output and full-stack
 * builds alike, neither user-facing yet. With it off `site deploy` takes the
 * legacy tar.gz upload and the flags that only mean something on this lane are
 * not registered at all, so the whole lane is one env var away from existing.
 *
 * It is the only thing that selects the transport: whether the build carries a
 * worker changes what `deployToDeployments()` sends, never which flow runs.
 */
export function deploymentsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[DEPLOYMENTS_API_ENV];
  return value === "1" || value === "true";
}

/**
 * Deploy a build for a commit through the deployments API: hash its static
 * assets into a manifest, create the deployment at the commit's address, upload
 * whichever assets the server asks for, and finalize.
 *
 * Whether the build carries a user worker changes only what this sends. A
 * worker's config goes on the create call — which is also what makes the server
 * store the assets on Cloudflare rather than S3 — and its modules complete the
 * deployment at finalize; with no worker, create carries no config and the
 * index.html sentinel completes it.
 *
 * Builds only — nothing here publishes. What production serves is decided by
 * the platform publish flow.
 */
export async function deployToDeployments(options: {
  projectRoot: string;
  /** Static output directory from the app config, when it has one. */
  outputDir: string | null;
  gitHash: string;
  concurrency?: number;
  progress?: DeploymentProgress;
}): Promise<{ deploymentId: string; gitHash: string }> {
  const { projectRoot, outputDir, gitHash, concurrency, progress } = options;

  const worker = await resolveWorkerBuild(projectRoot, progress);
  const assetsDir = worker ? worker.assetsDir : outputDir;
  const assets = assetsDir
    ? await buildAssetManifest(assetsDir, getAppContext().id)
    : NO_ASSETS;

  // Resolved before the create call so a build that cannot be completed fails
  // before any upload work.
  const completion: Completion = worker
    ? { modules: worker.modules }
    : { indexHtml: await readIndexHtml(assetsDir, assets) };

  const created = await createDeployment({
    git_hash: gitHash,
    config: worker?.config,
    asset_manifest: assets.manifest,
  });

  const completionJwt = await uploadDeploymentAssets(
    created.assetUploads,
    assets,
    { concurrency, progress },
  );

  if ("modules" in completion) {
    progress?.onWorker?.({ moduleCount: completion.modules.length });
  }
  const finalized = await finalizeDeployment(
    created.deploymentId,
    created.sessionId,
    "modules" in completion ? { ...completion, completionJwt } : completion,
  );

  return { deploymentId: finalized.deploymentId, gitHash };
}

/** Null when this build produced no worker — i.e. a plain static build. */
async function resolveWorkerBuild(
  projectRoot: string,
  progress?: DeploymentProgress,
): Promise<WorkerBuild | null> {
  if (!(await detectFullStackArtifact(projectRoot))) {
    return null;
  }

  const config = await resolveWranglerConfig(projectRoot);

  // Warn rather than inject the flag: the config is generated, so the fix
  // belongs in the framework's adapter settings.
  if (!config.compatibilityFlags.includes("nodejs_compat")) {
    progress?.onWarning?.(
      "The wrangler config has no 'nodejs_compat' compatibility flag; Node.js built-ins will be unavailable at runtime. Enable it in your framework's Cloudflare adapter settings if your server code needs Node APIs.",
    );
  }

  // A deploy can't introduce env of its own, so wrangler `vars` never reach
  // the worker.
  if (Object.keys(config.vars).length > 0) {
    progress?.onWarning?.(
      "wrangler 'vars' are not supported and were ignored — a worker's environment comes from the app's secrets (base44 secrets set).",
    );
  }

  const assetsDir =
    config.assetsDirectory && (await pathExists(config.assetsDirectory))
      ? config.assetsDirectory
      : null;

  return {
    config: {
      main: config.main,
      compatibility_date: config.compatibilityDate,
      compatibility_flags: config.compatibilityFlags,
      assets: buildAssetsConfig(config.assetsConfig, progress),
    },
    modules: await collectModules(config),
    assetsDir,
  };
}

/**
 * Finalize carries these bytes by contract when no worker completes the
 * deployment, so a build with no index.html at its root is broken — or the
 * configured outputDirectory points at the wrong place.
 */
async function readIndexHtml(
  assetsDir: string | null,
  assets: AssetManifestResult,
): Promise<Uint8Array> {
  if (!assetsDir || !assets.manifest["/index.html"]) {
    throw new InvalidInputError(
      `No index.html found in "${assetsDir ?? "the site output directory"}" — a static site needs one at the output directory root.`,
    );
  }
  return new Uint8Array(await readFile(join(assetsDir, "index.html")));
}

/**
 * The subset of the wrangler assets config the deployments API accepts. The
 * unsupported fields would change runtime behavior if dropped silently, so each
 * drop is surfaced as a warning.
 */
function buildAssetsConfig(
  assetsConfig: ResolvedWranglerConfig["assetsConfig"],
  progress?: DeploymentProgress,
): WorkerConfig["assets"] {
  if (!assetsConfig) return null;

  if (assetsConfig.headers || assetsConfig.redirects) {
    progress?.onWarning?.(
      "_headers/_redirects files are not supported yet and were ignored for this deploy.",
    );
  }

  let runWorkerFirst: boolean | undefined;
  if (Array.isArray(assetsConfig.runWorkerFirst)) {
    progress?.onWarning?.(
      "'run_worker_first' route patterns are not supported yet and were ignored for this deploy.",
    );
  } else {
    runWorkerFirst = assetsConfig.runWorkerFirst;
  }

  return {
    html_handling: assetsConfig.htmlHandling,
    not_found_handling: assetsConfig.notFoundHandling,
    run_worker_first: runWorkerFirst,
  };
}
