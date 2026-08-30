import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import { createDeployment, finalizeStaticDeployment } from "./api.js";
import { buildAssetManifest } from "./manifest.js";
import type { DeploymentProgress } from "./schema.js";
import { uploadPresignedAssets } from "./upload.js";

/**
 * Internal gate for the experimental static-site deployments-API lane, not
 * user-facing yet: with it off, a static output keeps taking the legacy tar.gz
 * upload.
 */
const STATIC_DEPLOYMENTS_ENV = "BASE44_STATIC_DEPLOYMENTS";

export function staticDeploymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[STATIC_DEPLOYMENTS_ENV];
  return value === "1" || value === "true";
}

/**
 * Deploy a static site build through the deployments API: hash the output
 * directory into an asset manifest, create the deployment at the commit's
 * address with no worker config, PUT the requested files to their presigned
 * URLs, and finalize with the index.html bytes.
 */
export async function deployStaticSite(options: {
  outputDir: string;
  gitHash: string;
  concurrency?: number;
  progress?: DeploymentProgress;
}): Promise<{ deploymentId: string; gitHash: string }> {
  const { outputDir, gitHash, concurrency, progress } = options;

  const assets = await buildAssetManifest(outputDir, getAppContext().id);
  // Finalize carries the index.html bytes by contract, so its absence is a
  // broken build (or a wrong outputDirectory) — fail before any upload.
  if (!assets.manifest["/index.html"]) {
    throw new InvalidInputError(
      `No index.html found in "${outputDir}" — a static site needs one at the output directory root.`,
    );
  }

  const created = await createDeployment({
    git_hash: gitHash,
    asset_manifest: assets.manifest,
  });
  if (created.assetUploads && created.assetUploads.type !== "s3") {
    throw new ApiError(
      `The server answered a static-site deploy with the "${created.assetUploads.type}" upload target.`,
    );
  }

  progress?.onAssets?.({
    totalAssets: Object.keys(assets.manifest).length,
    newAssets: created.assetUploads?.uploads.length ?? 0,
  });

  if (created.assetUploads) {
    await uploadPresignedAssets(created.assetUploads.uploads, assets, {
      concurrency,
      onProgress: progress?.onAssetUpload,
    });
  }

  const indexHtml = await readFile(join(outputDir, "index.html"));
  const finalized = await finalizeStaticDeployment(
    created.deploymentId,
    new Uint8Array(indexHtml),
    created.sessionId,
  );

  return { deploymentId: finalized.deploymentId, gitHash };
}
