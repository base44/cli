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

export type ModuleType = "esm" | "sourcemap" | "wasm" | "text" | "data";

export interface WorkerModule {
  /** Path relative to the wrangler config dir, forward slashes. */
  name: string;
  absolutePath: string;
  size: number;
  type: ModuleType;
}

/** Manifest entry keyed by URL-ish path ("/index.html"). */
export interface AssetManifestEntry {
  hash: string;
  size: number;
}

export interface AssetFile {
  absolutePath: string;
  hash: string;
  size: number;
  contentType: string;
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
  onWarning?: (message: string) => void;
  onAssets?: (info: { totalAssets: number; newAssets: number }) => void;
  onAssetUpload?: (progress: AssetUploadProgress) => void;
  onWorker?: (info: { moduleCount: number }) => void;
}

/**
 * Request payload for POST deployments (sent as snake_case JSON). `config` is
 * what selects the deploy target server-side: a worker config means a
 * Cloudflare deployment, no `config` field at all a static-site deployment.
 */
export interface CreateDeploymentRequest {
  git_hash: string;
  config?: {
    main: string;
    compatibility_date: string | null;
    compatibility_flags: string[];
    assets: {
      html_handling?: string;
      not_found_handling?: string;
      run_worker_first?: boolean;
    } | null;
  };
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

/**
 * The `cf` arm's upload target. Exactly one bucket reply carries the completion
 * token finalize wants back: the server decides completeness by manifest
 * membership ("every file in the manifest has been uploaded"), so the token
 * goes to whichever request completes the set — NOT to the last bucket in this
 * array. Buckets upload concurrently, so read the token opportunistically from
 * whichever reply carries one; indexing the final bucket would usually read an
 * empty result and throw away a token already in hand.
 */
export interface CfAssetUploads {
  type: "cf";
  url: string;
  /** Upload-session token — sent as `Authorization: Bearer`. */
  jwt: string;
  /** Asset hashes grouped by Cloudflare, one POST per bucket. */
  buckets: string[][];
}

interface S3AssetUploads {
  type: "s3";
  uploads: PresignedAssetUpload[];
}

/**
 * `asset_uploads` says where the assets still owed should go, discriminated on
 * `type` — `cf` when the request carried a worker config, `s3` when it carried
 * none — and is null when nothing is owed.
 */
export const CreateDeploymentResponseSchema = z
  .object({
    deployment_id: z.string(),
    asset_uploads: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("cf"),
          url: z.string(),
          jwt: z.string(),
          buckets: z.array(z.array(z.string())),
        }),
        z.object({
          type: z.literal("s3"),
          uploads: z.array(
            z.object({
              path: z.string(),
              content_type: z.string(),
              content_length: z.number(),
              url: z.string(),
            }),
          ),
        }),
      ])
      .nullable()
      .optional(),
  })
  .transform(
    (
      data,
    ): {
      deploymentId: string;
      assetUploads: CfAssetUploads | S3AssetUploads | null;
    } => ({
      deploymentId: data.deployment_id,
      assetUploads:
        data.asset_uploads == null
          ? null
          : data.asset_uploads.type === "cf"
            ? data.asset_uploads
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

/**
 * Cloudflare's reply to a bucket upload, relayed verbatim by the backend. Only
 * the reply that completes the asset set carries a token, hence all-optional.
 */
export const AssetUploadResponseSchema = z.looseObject({
  result: z
    .looseObject({ jwt: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

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
