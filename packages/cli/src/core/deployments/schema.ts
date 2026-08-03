import { z } from "zod";

// ─── SHARED ──────────────────────────────────────────────────

/** Manifest entry keyed by URL-ish path ("/index.html"). */
export interface AssetManifestEntry {
  hash: string;
  size: number;
}

/** A static asset discovered in the assets directory, keyed by hash. */
export interface AssetFile {
  /** Absolute path on disk. */
  absolutePath: string;
  hash: string;
  size: number;
}

export interface AssetManifestResult {
  /** URL path → { hash, size }, ready for the create-deployment payload. */
  manifest: Record<string, AssetManifestEntry>;
  /** Hash → file info, used to serve the requested uploads. */
  filesByHash: Map<string, AssetFile>;
}

/** Progress of an in-flight asset upload set. */
export interface AssetUploadProgress {
  uploadedFiles: number;
  totalFiles: number;
}

/** Progress callbacks a deploy fires as it moves through its stages. */
export interface DeploymentProgress {
  /** Fired for non-fatal issues worth surfacing to the user. */
  onWarning?: (message: string) => void;
  /** Fired after the deployment is created: total assets and how many need uploading. */
  onAssets?: (info: { totalAssets: number; newAssets: number }) => void;
  /** Fired after each asset upload completes. */
  onAssetUpload?: (progress: AssetUploadProgress) => void;
}

/**
 * A deployment is addressed by the commit that produced it: the server derives
 * the deployment id from `git_hash`, so one commit means one deployment and
 * re-deploying a commit is idempotent. Same pattern the server validates.
 */
export const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

/**
 * Request payload for POST deployments (sent as snake_case JSON). A request
 * without a worker config is a static-site deployment — the server answers
 * it with the `s3` arm of the create response.
 */
export interface CreateDeploymentRequest {
  git_hash: string;
  asset_manifest: Record<string, AssetManifestEntry>;
}

// ─── RESPONSES ───────────────────────────────────────────────

/** A static asset the server wants uploaded, with its presigned S3 URL. */
export interface PresignedAssetUpload {
  /** Manifest path of the asset ("/assets/app.js"). */
  path: string;
  /** Content-Type signed into the URL — the PUT must send it verbatim. */
  contentType: string;
  /** Byte count signed into the URL — the PUT body must be exactly this long. */
  contentLength: number;
  /** Presigned S3 URL — the URL itself is the credential. */
  url: string;
}

interface S3AssetUploads {
  type: "s3";
  uploads: PresignedAssetUpload[];
}

/**
 * POST deployments answers `{deployment_id, asset_uploads}` where
 * `asset_uploads` says where the assets still owed should go, discriminated
 * on `type` — a config-less (static-site) request is always answered with
 * the `s3` arm: direct presigned PUTs, always excluding `/index.html`
 * (finalize carries it) — and is null when nothing is owed (no assets, or
 * the build already exists).
 */
export const CreateDeploymentResponseSchema = z
  .object({
    deployment_id: z.string(),
    asset_uploads: z
      .object({
        type: z.literal("s3"),
        uploads: z.array(
          z.object({
            path: z.string(),
            content_type: z.string(),
            content_length: z.number(),
            url: z.string(),
          }),
        ),
      })
      .nullable()
      .optional(),
  })
  .transform(
    (
      data,
    ): {
      deploymentId: string;
      assetUploads: S3AssetUploads | null;
    } => ({
      deploymentId: data.deployment_id,
      assetUploads:
        data.asset_uploads == null
          ? null
          : {
              type: "s3",
              uploads: data.asset_uploads.uploads.map((upload) => ({
                path: upload.path,
                contentType: upload.content_type,
                contentLength: upload.content_length,
                url: upload.url,
              })),
            },
    }),
  );

export type CreateDeploymentResponse = z.infer<
  typeof CreateDeploymentResponseSchema
>;

export const FinalizeDeploymentResponseSchema = z
  .object({
    deployment_id: z.string(),
  })
  .transform((data) => ({
    deploymentId: data.deployment_id,
  }));

export type FinalizeDeploymentResponse = z.infer<
  typeof FinalizeDeploymentResponseSchema
>;
