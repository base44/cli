import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import ky from "ky";
import pMap from "p-map";
import { ApiError, InternalError } from "@/core/errors.js";
import type {
  AssetManifestResult,
  AssetUploadProgress,
  PresignedAssetUpload,
} from "./schema.js";

export const DEFAULT_UPLOAD_CONCURRENCY = 3;

/** Each worker holds a whole file in memory, so the ceiling is a memory bound. */
export const MAX_UPLOAD_CONCURRENCY = 50;

const MAX_ATTEMPTS_PER_UPLOAD = 3;
const RETRY_BASE_DELAY_MS = 500;

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
      await uploadPresignedAssetWithRetry(upload, assets);
      uploadedFiles++;
      onProgress?.({ uploadedFiles, totalFiles: uploads.length });
    },
    { concurrency },
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
