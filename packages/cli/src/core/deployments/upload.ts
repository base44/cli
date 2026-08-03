import { readFile } from "node:fs/promises";
import ky from "ky";
import { ApiError, InternalError } from "@/core/errors.js";
import type {
  AssetManifestResult,
  AssetUploadProgress,
  PresignedAssetUpload,
} from "./schema.js";

const UPLOAD_CONCURRENCY = 3;
const MAX_ATTEMPTS_PER_UPLOAD = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * PUT static assets directly to their presigned S3 URLs (the `s3` create
 * arm). A presigned URL carries its own authorization in the query string, so
 * each request is a plain fetch — never the app client, never an
 * Authorization header. Uploads run with concurrency 3;
 * each file gets 3 attempts with exponential backoff.
 */
export async function uploadPresignedAssets(
  uploads: PresignedAssetUpload[],
  assets: AssetManifestResult,
  onProgress?: (progress: AssetUploadProgress) => void,
): Promise<void> {
  let uploadedFiles = 0;

  let nextUpload = 0;
  const worker = async (): Promise<void> => {
    while (nextUpload < uploads.length) {
      const upload = uploads[nextUpload++];
      await uploadPresignedAssetWithRetry(upload, assets);
      uploadedFiles++;
      onProgress?.({ uploadedFiles, totalFiles: uploads.length });
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, uploads.length) },
      worker,
    ),
  );
}

async function uploadPresignedAssetWithRetry(
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

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_UPLOAD; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    try {
      await ky.put(upload.url, {
        body: new Uint8Array(content),
        // The server signed this exact Content-Type into the URL — deriving
        // our own value would 403 on any mapping difference.
        headers: { "Content-Type": upload.contentType },
        timeout: 120_000,
        retry: 0,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw await ApiError.fromHttpError(lastError, "uploading static assets");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
