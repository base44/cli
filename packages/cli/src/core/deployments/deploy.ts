import { ApiError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import { pathExists } from "@/core/utils/fs.js";
import { createDeployment, finalizeDeployment } from "./api.js";
import { buildAssetManifest } from "./manifest.js";
import { collectModules } from "./modules.js";
import type { AssetManifestResult, DeploymentProgress } from "./schema.js";
import { uploadAssetBuckets } from "./upload.js";
import { resolveWranglerConfig } from "./wrangler-config.js";

interface FullStackDeployResult {
  deploymentId: string;
  gitHash: string;
}

/**
 * Deploy a full-stack (Cloudflare Workers) build artifact for a commit:
 * resolve the wrangler config, collect worker modules and static assets,
 * create the deployment at the commit's address, POST the requested asset
 * buckets directly to Cloudflare, then finalize with the worker modules.
 *
 * Builds only — nothing here publishes. What production serves is decided by
 * the platform publish flow, and re-deploying the same commit is idempotent.
 */
export async function deployFullStack(options: {
  projectRoot: string;
  gitHash: string;
  progress?: DeploymentProgress;
}): Promise<FullStackDeployResult> {
  const { projectRoot, gitHash, progress } = options;

  const config = await resolveWranglerConfig(projectRoot);

  // Some frameworks (e.g. Astro 6) emit a wrangler.json without any
  // compatibility flags; server code using Node built-ins would then fail at
  // runtime. Warn instead of injecting the flag — the config is generated, so
  // the fix belongs in the framework/adapter settings.
  if (!config.compatibilityFlags.includes("nodejs_compat")) {
    progress?.onWarning?.(
      "The wrangler config has no 'nodejs_compat' compatibility flag; Node.js built-ins will be unavailable at runtime. Enable it in your framework's Cloudflare adapter settings if your server code needs Node APIs.",
    );
  }

  // A worker's environment is the app's secrets and built-ins — a deploy can't
  // introduce env of its own, so wrangler `vars` never reach the worker.
  if (config.vars && Object.keys(config.vars).length > 0) {
    progress?.onWarning?.(
      "wrangler 'vars' are not supported and were ignored — a worker's environment comes from the app's secrets (base44 secrets set).",
    );
  }

  const modules = await collectModules(config);

  let assets: AssetManifestResult = { manifest: {}, filesByHash: new Map() };
  if (config.assetsDirectory && (await pathExists(config.assetsDirectory))) {
    assets = await buildAssetManifest(
      config.assetsDirectory,
      getAppContext().id,
    );
  }

  const created = await createDeployment({
    git_hash: gitHash,
    config: {
      main: config.main,
      compatibility_date: config.compatibilityDate,
      compatibility_flags: config.compatibilityFlags,
      assets: buildAssetsConfig(config.assetsConfig, progress),
    },
    asset_manifest: assets.manifest,
  });
  if (created.assetUploads && created.assetUploads.type !== "cf") {
    throw new ApiError(
      `The server answered a full-stack deploy with the "${created.assetUploads.type}" upload target.`,
    );
  }

  const totalAssets = Object.keys(assets.manifest).length;
  const newAssets = created.assetUploads
    ? new Set(created.assetUploads.buckets.flat()).size
    : 0;
  progress?.onAssets?.({ totalAssets, newAssets });

  // No uploads owed means every asset is already stored (or there are none):
  // the server holds the token that completes the asset set, so the
  // completion JWT stays null.
  const completionJwt = created.assetUploads
    ? await uploadAssetBuckets(
        created.assetUploads,
        assets.filesByHash,
        progress?.onAssetUpload,
      )
    : null;

  progress?.onWorker?.({ moduleCount: modules.length });
  const finalized = await finalizeDeployment(
    created.deploymentId,
    completionJwt,
    modules,
  );

  return { deploymentId: finalized.deploymentId, gitHash };
}

/**
 * The subset of the wrangler assets config the deployments API accepts.
 * `_headers`/`_redirects` contents and `run_worker_first` route arrays have no
 * server-side support yet — dropping them silently would change runtime
 * behavior, so each drop is surfaced as a warning.
 */
function buildAssetsConfig(
  assetsConfig: {
    htmlHandling?: string;
    notFoundHandling?: string;
    runWorkerFirst?: boolean | string[];
    headers?: string;
    redirects?: string;
  } | null,
  progress?: DeploymentProgress,
): {
  html_handling?: string;
  not_found_handling?: string;
  run_worker_first?: boolean;
} | null {
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
