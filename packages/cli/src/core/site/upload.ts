import { readFile } from "node:fs/promises";
import type { KyResponse } from "ky";
import ky, { HTTPError } from "ky";
import pMap from "p-map";
import { ApiError, InternalError } from "@/core/errors.js";
import type {
  AssetFile,
  AssetManifestResult,
  AssetUploadProgress,
  CfAssetUploads,
  PresignedAssetUpload,
} from "./schema.js";
import { AssetUploadResponseSchema } from "./schema.js";

export const DEFAULT_UPLOAD_CONCURRENCY = 3;

/** Each worker holds a whole file in memory, so the ceiling is a memory bound. */
export const MAX_UPLOAD_CONCURRENCY = 50;

const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Shared by both upload arms. ky's default status codes are exactly what these
 * uploads want: an expired credential (401/403) fails fast instead of burning
 * every attempt, and a 429 waits out the server's `Retry-After`.
 */
const UPLOAD_RETRY = {
  limit: MAX_UPLOAD_ATTEMPTS - 1,
  delay: (attempt: number) => RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
} as const;

/**
 * POST the requested asset buckets directly to Cloudflare, authorized by the
 * upload-session jwt from create, and return the completion JWT finalize needs.
 */
export async function uploadAssetBuckets(
  target: CfAssetUploads,
  filesByHash: Map<string, AssetFile>,
  options: {
    concurrency?: number;
    onProgress?: (progress: AssetUploadProgress) => void;
  } = {},
): Promise<string | null> {
  const { concurrency = DEFAULT_UPLOAD_CONCURRENCY, onProgress } = options;
  const { buckets } = target;
  const totalFiles = buckets.reduce((sum, bucket) => sum + bucket.length, 0);
  let uploadedFiles = 0;
  let completionJwt: string | null = null;

  await pMap(
    buckets,
    async (bucket) => {
      const jwt = await uploadAssetBucket(target, bucket, filesByHash);
      if (jwt) {
        completionJwt = jwt;
      }
      uploadedFiles += bucket.length;
      onProgress?.({ uploadedFiles, totalFiles });
    },
    { concurrency },
  );

  if (!completionJwt) {
    throw new ApiError(
      "Asset upload finished but the server did not return a completion token.",
    );
  }

  return completionJwt;
}

async function uploadAssetBucket(
  target: CfAssetUploads,
  bucket: string[],
  filesByHash: Map<string, AssetFile>,
): Promise<string | null> {
  const formData = await buildBucketForm(bucket, filesByHash);

  let response: KyResponse;
  try {
    // Straight to Cloudflare under the upload-session jwt — never the app
    // client, and never app auth.
    response = await ky.post(target.url, {
      searchParams: { base64: "true" },
      headers: { Authorization: `Bearer ${target.jwt}` },
      body: formData,
      timeout: 120_000,
      // POST is absent from ky's default retry methods, so naming it is what
      // makes these uploads retry at all.
      retry: { ...UPLOAD_RETRY, methods: ["post"] },
    });
  } catch (error) {
    if (
      error instanceof HTTPError &&
      (error.response.status === 401 || error.response.status === 403)
    ) {
      throw new ApiError(
        "This deploy's upload session has expired — rerun deploy. Already-uploaded assets are skipped on the next attempt.",
        { statusCode: error.response.status, cause: error },
      );
    }
    throw await ApiError.fromHttpError(error, "uploading assets to Cloudflare");
  }

  const parsed = AssetUploadResponseSchema.safeParse(await response.json());
  const jwt = parsed.success ? parsed.data.result?.jwt : null;
  return jwt || null;
}

async function buildBucketForm(
  bucket: string[],
  filesByHash: Map<string, AssetFile>,
): Promise<FormData> {
  const formData = new FormData();

  for (const hash of bucket) {
    const file = filesByHash.get(hash);
    if (!file) {
      throw new InternalError(
        `Server requested upload of unknown asset hash: ${hash}`,
      );
    }
    const content = await readFile(file.absolutePath);
    formData.append(
      hash,
      new File([content.toString("base64")], hash, { type: file.contentType }),
    );
  }

  return formData;
}

/**
 * PUT static assets directly to their presigned S3 URLs. A presigned URL
 * carries its own authorization in the query string, so each request is a plain
 * fetch — never the app client, never an Authorization header.
 */
export async function uploadPresignedAssets(
  uploads: PresignedAssetUpload[],
  assets: AssetManifestResult,
  options: {
    concurrency?: number;
    onProgress?: (progress: AssetUploadProgress) => void;
  } = {},
): Promise<void> {
  const { concurrency = DEFAULT_UPLOAD_CONCURRENCY, onProgress } = options;
  let uploadedFiles = 0;

  await pMap(
    uploads,
    async (upload) => {
      await uploadPresignedAsset(upload, assets);
      uploadedFiles++;
      onProgress?.({ uploadedFiles, totalFiles: uploads.length });
    },
    { concurrency },
  );
}

async function uploadPresignedAsset(
  upload: PresignedAssetUpload,
  assets: AssetManifestResult,
): Promise<void> {
  const entry = assets.manifest[upload.path];
  const file = entry && assets.filesByHash.get(entry.hash);
  if (!file) {
    throw new InternalError(
      `Server requested upload of unknown asset path: ${upload.path}`,
    );
  }
  const content = await readFile(file.absolutePath);

  try {
    await ky.put(upload.url, {
      body: new Uint8Array(content),
      // The server signed this exact Content-Type into the URL — deriving
      // our own value would 403 on any mapping difference.
      headers: { "Content-Type": upload.contentType },
      timeout: 120_000,
      // PUT is already a default retry method.
      retry: UPLOAD_RETRY,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "uploading static assets");
  }
}
