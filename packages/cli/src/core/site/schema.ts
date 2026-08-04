import { z } from "zod";

/**
 * Response from the deploy API endpoint.
 */
export const DeployResponseSchema = z
  .object({
    app_url: z.url(),
  })
  .transform((data) => ({
    appUrl: data.app_url,
  }));

export type DeployResponse = z.infer<typeof DeployResponseSchema>;

export const PublishedUrlResponseSchema = z.object({
  url: z.string(),
});

/** Manifest entry keyed by URL-ish path ("/index.html"). */
export interface AssetManifestEntry {
  hash: string;
  size: number;
}

export interface AssetFile {
  absolutePath: string;
  hash: string;
  size: number;
}

export interface AssetManifestResult {
  manifest: Record<string, AssetManifestEntry>;
  filesByHash: Map<string, AssetFile>;
}

export interface AssetUploadProgress {
  uploadedFiles: number;
  totalFiles: number;
}

export interface DeploymentProgress {
  onAssets?: (info: { totalAssets: number; newAssets: number }) => void;
  onAssetUpload?: (progress: AssetUploadProgress) => void;
}

/**
 * A request without a worker config is a static-site deployment, which the
 * server answers with the `s3` arm of the create response. The deployment id
 * is derived from `git_hash`, so re-deploying a commit is idempotent.
 */
export interface CreateDeploymentRequest {
  git_hash: string;
  asset_manifest: Record<string, AssetManifestEntry>;
}

export interface PresignedAssetUpload {
  path: string;
  /** Content-Type signed into the URL — the PUT must send it verbatim. */
  contentType: string;
  contentLength: number;
  /** Presigned S3 URL — the URL itself is the credential. */
  url: string;
}

interface S3AssetUploads {
  type: "s3";
  uploads: PresignedAssetUpload[];
}

/**
 * `asset_uploads` says where the assets still owed should go, discriminated on
 * `type`. The `s3` arm always excludes `/index.html` (finalize carries it), and
 * the whole field is null when nothing is owed.
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
