import { readFile } from "node:fs/promises";
import type { KyResponse } from "ky";
import ky from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  CreateDeploymentRequest,
  CreateDeploymentResponse,
  FinalizeDeploymentResponse,
  ModuleType,
  WorkerModule,
} from "./schema.js";
import {
  AssetUploadResponseSchema,
  CreateDeploymentResponseSchema,
  FinalizeDeploymentResponseSchema,
} from "./schema.js";

const MODULE_CONTENT_TYPES: Record<ModuleType, string> = {
  esm: "application/javascript+module",
  sourcemap: "application/source-map",
  wasm: "application/wasm",
  text: "text/plain",
  data: "application/octet-stream",
};

export async function createDeployment(
  request: CreateDeploymentRequest,
): Promise<CreateDeploymentResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post("deployments", {
      json: request,
      timeout: 120_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "creating deployment");
  }

  const result = CreateDeploymentResponseSchema.safeParse(
    await response.json(),
  );
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

/**
 * POST one bucket of asset bytes directly to Cloudflare's assets endpoint,
 * authorized by the upload-session jwt from create. The final bucket's
 * response carries the completion token. Errors are NOT wrapped here: the
 * caller owns retry and error mapping per bucket.
 */
export async function uploadAssetBucket(
  target: { url: string; jwt: string },
  formData: FormData,
): Promise<string | null> {
  // Straight to Cloudflare: the upload-session jwt is the credential, so this
  // never goes through the app client (and must not carry app auth).
  const response: KyResponse = await ky.post(target.url, {
    searchParams: { base64: "true" },
    headers: { Authorization: `Bearer ${target.jwt}` },
    body: formData,
    timeout: 120_000,
    retry: 0,
  });

  const parsed = AssetUploadResponseSchema.safeParse(await response.json());
  const jwt = parsed.success ? parsed.data.result?.jwt : null;
  return jwt || null;
}

export async function finalizeDeployment(
  deploymentId: string,
  completionJwt: string | null,
  modules: WorkerModule[],
): Promise<FinalizeDeploymentResponse> {
  const formData = new FormData();
  formData.append("payload", JSON.stringify({ completion_jwt: completionJwt }));

  for (const module of modules) {
    const content = await readFile(module.absolutePath);
    formData.append(
      module.name,
      new File([new Uint8Array(content)], module.name, {
        type: MODULE_CONTENT_TYPES[module.type],
      }),
    );
  }

  return await postFinalize(deploymentId, formData);
}

/**
 * Finalize a static-site (s3-target) deployment. The form carries exactly one
 * file part — `index.html` — and nothing else (no `payload`, no modules):
 * index.html is always excluded from the presigned uploads and travels
 * through finalize as the sentinel that completes the deployment.
 */
export async function finalizeStaticDeployment(
  deploymentId: string,
  indexHtml: Uint8Array,
): Promise<FinalizeDeploymentResponse> {
  const formData = new FormData();
  formData.append(
    "index.html",
    new File([indexHtml], "index.html", { type: "text/html" }),
  );
  return await postFinalize(deploymentId, formData);
}

async function postFinalize(
  deploymentId: string,
  formData: FormData,
): Promise<FinalizeDeploymentResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post(
      `deployments/${encodeURIComponent(deploymentId)}/finalize`,
      { body: formData, timeout: 180_000 },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "finalizing deployment");
  }

  const result = FinalizeDeploymentResponseSchema.safeParse(
    await response.json(),
  );
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}
