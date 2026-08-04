import { readFile } from "node:fs/promises";
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

const MAX_UPLOAD_ATTEMPTS = 3;
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
