import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import { createDeployment, finalizeStaticDeployment } from "./api.js";
import { buildAssetManifest } from "./manifest.js";
import type { DeploymentProgress } from "./schema.js";
import { uploadPresignedAssets } from "./upload.js";

/**
 * Internal gate for the experimental static-site deployments-API lane. Not
 * user-facing yet: when set to "1" or "true", `base44 deploy` sends the
 * configured site output through the deployments API instead of the legacy
 * tar.gz site upload.
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
 * directory into an asset manifest and create the deployment at the commit's
 * address with no worker config — which the server answers with the `s3` arm
 * of the discriminated create response — then PUT the requested files
 * directly to their presigned URLs and finalize with the index.html bytes.
 *
 * This is the progressive-upgrade path: when the app later adopts a server
 * framework, the create request carries its worker config and the server
 * answers with the `cf` arm instead — same CLI protocol, zero CLI change.
 */
export async function deployStaticSite(options: {
  outputDir: string;
  gitHash: string;
  progress?: DeploymentProgress;
}): Promise<{ deploymentId: string; gitHash: string }> {
  const { outputDir, gitHash, progress } = options;

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
  // The uploads always exclude index.html; null means every asset is already
  // stored (re-deploying a commit is idempotent).
  const totalAssets = Object.keys(assets.manifest).length;
  progress?.onAssets?.({
    totalAssets,
    newAssets: created.assetUploads?.uploads.length ?? 0,
  });

  if (created.assetUploads) {
    await uploadPresignedAssets(
      created.assetUploads.uploads,
      assets,
      progress?.onAssetUpload,
    );
  }

  const indexHtml = await readFile(join(outputDir, "index.html"));
  const finalized = await finalizeStaticDeployment(
    created.deploymentId,
    new Uint8Array(indexHtml),
  );

  return { deploymentId: finalized.deploymentId, gitHash };
}
