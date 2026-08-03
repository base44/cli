import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  CreateDeploymentRequest,
  CreateDeploymentResponse,
  FinalizeDeploymentResponse,
} from "./schema.js";
import {
  CreateDeploymentResponseSchema,
  FinalizeDeploymentResponseSchema,
} from "./schema.js";

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
