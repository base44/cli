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

// ─── SHARED ──────────────────────────────────────────────────

/** Worker module types accepted by the deployments API. */
export type ModuleType = "esm" | "sourcemap" | "wasm" | "text" | "data";

/** A collected worker module (bytes are read lazily at finalize time). */
export interface WorkerModule {
  /** Module name: path relative to the wrangler config dir (forward slashes). */
  name: string;
  /** Absolute path on disk. */
  absolutePath: string;
  size: number;
  type: ModuleType;
}

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
  contentType: string;
}

export interface AssetManifestResult {
  /** URL path → { hash, size }, ready for the create-deployment payload. */
  manifest: Record<string, AssetManifestEntry>;
  /** Hash → file info, used to serve upload buckets. */
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
  /** Fired before the worker modules are uploaded (finalize). */
  onWorker?: (info: { moduleCount: number }) => void;
}

/**
 * Request payload for POST deployments (sent as snake_case JSON). `config` is
 * what selects the deploy target server-side: a worker config means a
 * Cloudflare deployment; a request with no `config` field at all is a
 * static-site deployment.
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

/** The `cf` arm's upload target: asset buckets POSTed directly to Cloudflare,
 * authorized by the upload-session token. The last bucket's reply carries the
 * completion token finalize wants back. */
export interface CfAssetUploads {
  type: "cf";
  /** Cloudflare's assets upload endpoint. */
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
 * POST deployments answers `{deployment_id, asset_uploads}` where
 * `asset_uploads` says where the assets still owed should go — `cf` (direct
 * bucket POSTs to Cloudflare, when the request carried a worker `config`) or
 * `s3` (direct presigned PUTs, when it carried none) — and is null when
 * nothing is owed (no assets, or the build already exists).
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
 * Response of an asset bucket upload — Cloudflare's reply, relayed verbatim
 * by the backend. Only the final response carries the completion token, so
 * everything is optional here.
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
