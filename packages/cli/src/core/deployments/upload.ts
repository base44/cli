import { readFile } from "node:fs/promises";
import ky, { HTTPError } from "ky";
import pMap from "p-map";
import { ApiError, InternalError } from "@/core/errors.js";
import { uploadAssetBucket } from "./api.js";
import type {
  AssetFile,
  AssetManifestResult,
  AssetUploadProgress,
  CfAssetUploads,
  PresignedAssetUpload,
} from "./schema.js";

export const DEFAULT_UPLOAD_CONCURRENCY = 3;

/** Each worker holds a whole file in memory, so the ceiling is a memory bound. */
export const MAX_UPLOAD_CONCURRENCY = 50;

const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
// A 429 from the upload endpoint is a pause, not a failure — wait out the
// window and go again, without burning the regular error-retry attempts.
const MAX_RATE_LIMIT_WAITS = 10;
const RATE_LIMIT_DELAY_MS = 15_000;

/**
 * POST the requested asset buckets directly to Cloudflare, authorized by the
 * upload-session jwt from create. Each bucket is retried up to 3 times with
 * exponential backoff. The final response carries the completion JWT required
 * to finalize.
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
      const jwt = await uploadBucketWithRetry(target, bucket, filesByHash);
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

async function uploadBucketWithRetry(
  target: CfAssetUploads,
  bucket: string[],
  filesByHash: Map<string, AssetFile>,
): Promise<string | null> {
  let lastError: unknown;
  let rateLimitWaits = 0;
  const formData = await buildBucketForm(bucket, filesByHash);

  for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    try {
      return await uploadAssetBucket(target, formData);
    } catch (error) {
      if (
        error instanceof HTTPError &&
        error.response.status === 429 &&
        rateLimitWaits < MAX_RATE_LIMIT_WAITS
      ) {
        rateLimitWaits++;
        attempt--; // a throttle is not a failed attempt
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }
      lastError = error;
    }
  }

  if (
    lastError instanceof HTTPError &&
    (lastError.response.status === 401 || lastError.response.status === 403)
  ) {
    throw new ApiError(
      "This deploy's upload session has expired — rerun deploy. Already-uploaded assets are skipped on the next attempt.",
      { statusCode: lastError.response.status, cause: lastError },
    );
  }
  throw await ApiError.fromHttpError(
    lastError,
    "uploading assets to Cloudflare",
  );
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
 * PUT static assets directly to their presigned S3 URLs (the `s3` create
 * arm). A presigned URL carries its own authorization in the query string, so
 * each request is a plain fetch — never the app client, never an
 * Authorization header.
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
      // ky retries network errors and 408/429/5xx only, so a 403 from an
      // expired URL fails fast instead of burning every attempt.
      retry: {
        limit: MAX_UPLOAD_ATTEMPTS - 1,
        delay: (attempt) => RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "uploading static assets");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
