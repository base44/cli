import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import { pathExists } from "@/core/utils/fs.js";
import type { FinalizePayload } from "./api.js";
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

const NO_ASSETS: AssetManifestResult = { manifest: {}, filesByHash: new Map() };

const DEPLOYMENTS_API_ENV = "BASE44_DEPLOYMENTS_API";

/**
 * Internal gate for shipping STATIC output through the deployments-API lane.
 * With it off, a build with no worker takes the legacy tar.gz upload and the
 * flags that only mean something on this lane are not registered at all.
 *
 * A build that carries a worker never consults it: the tar.gz upload cannot
 * carry a worker, so `hasWorkerBuild()` sends such a build down this lane
 * whatever the env says.
 */
export function deploymentsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[DEPLOYMENTS_API_ENV];
  return value === "1" || value === "true";
}

/** Whether the build emitted a worker, which only the deployments API can ship. */
export async function hasWorkerBuild(projectRoot: string): Promise<boolean> {
  return (await detectFullStackArtifact(projectRoot)) !== null;
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

  // Checked before the create call so a build that cannot be completed fails
  // before any upload work — the bytes are only read if finalize carries them.
  if (!worker) {
    requireStaticEntryPoint(assetsDir, assets);
  }

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

  const completion: FinalizePayload = worker
    ? { kind: "worker", modules: worker.modules, completionJwt }
    : await resolveStaticCompletion(assetsDir, assets, created.indexHtmlStaged);

  if (completion.kind === "worker") {
    progress?.onWorker?.({ moduleCount: completion.modules.length });
  }
  const finalized = await finalizeDeployment(
    created.deploymentId,
    created.sessionId,
    completion,
  );

  return { deploymentId: finalized.deploymentId, gitHash };
}

async function resolveWorkerBuild(
  projectRoot: string,
  progress?: DeploymentProgress,
): Promise<WorkerBuild | null> {
  const redirectPath = await detectFullStackArtifact(projectRoot);
  if (!redirectPath) {
    return null;
  }

  const config = await resolveWranglerConfig(redirectPath);

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
 * A static build is addressed by its entry point, so one without an index.html
 * at its root is broken — or the configured outputDirectory points at the wrong
 * place. Checked against the manifest, which is already built.
 */
function requireStaticEntryPoint(
  assetsDir: string | null,
  assets: AssetManifestResult,
): string {
  if (!assetsDir || !assets.manifest["/index.html"]) {
    throw new InvalidInputError(
      `No index.html found in "${assetsDir ?? "the site output directory"}" — a static site needs one at the output directory root.`,
    );
  }
  return assetsDir;
}

/**
 * How a static build completes. A current server stages the entry point with
 * the other presigned uploads and copies it in, so finalize sends nothing;
 * older ones still expect the bytes in the request body.
 */
async function resolveStaticCompletion(
  assetsDir: string | null,
  assets: AssetManifestResult,
  indexHtmlStaged: boolean,
): Promise<FinalizePayload> {
  if (indexHtmlStaged) return { kind: "static-staged" };
  const dir = requireStaticEntryPoint(assetsDir, assets);
  return {
    kind: "static-inline",
    indexHtml: new Uint8Array(await readFile(join(dir, "index.html"))),
  };
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
