import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import { getGitHead, isGitCommitHash } from "@/core/utils/git.js";
import { createDeployment, finalizeStaticDeployment } from "./api.js";
import { buildAssetManifest } from "./manifest.js";
import type { DeploymentProgress } from "./schema.js";
import { uploadPresignedAssets } from "./upload.js";

/**
 * Deploy a static site build through the deployments API: hash the output
 * directory into an asset manifest, create the deployment at the commit's
 * address with no worker config, PUT the requested files to their presigned
 * URLs, and finalize with the index.html bytes.
 */
export async function deployStaticSite(options: {
  outputDir: string;
  projectRoot: string;
  gitHash?: string;
  progress?: DeploymentProgress;
}): Promise<{ deploymentId: string; gitHash: string }> {
  const { outputDir, projectRoot, progress } = options;
  const gitHash = await resolveGitHash(projectRoot, options.gitHash);

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
  progress?.onAssets?.({
    totalAssets: Object.keys(assets.manifest).length,
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

/** An explicit hash (flag/automation) wins over the checkout's HEAD. */
async function resolveGitHash(
  projectRoot: string,
  explicit?: string,
): Promise<string> {
  const hash = explicit ?? (await getGitHead(projectRoot));
  if (!hash || !isGitCommitHash(hash)) {
    throw new InvalidInputError(
      explicit
        ? `'${explicit}' is not a git commit hash.`
        : "Deployments are addressed by the commit that produced the build, and no git commit was found.",
      {
        hints: [
          {
            message:
              "Run the deploy from a git checkout, or pass the commit explicitly: base44 site deploy --git-hash <commit>.",
          },
        ],
      },
    );
  }
  return hash;
}
