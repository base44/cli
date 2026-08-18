import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  CreateDeploymentRequest,
  CreateDeploymentResponse,
  DeployResponse,
  FinalizeDeploymentResponse,
} from "@/core/site/schema.js";
import {
  CreateDeploymentResponseSchema,
  DeployResponseSchema,
  FinalizeDeploymentResponseSchema,
} from "@/core/site/schema.js";
import { readFile } from "@/core/utils/fs.js";

/**
 * Uploads a tar.gz archive file to the Base44 hosting API.
 *
 * @param archivePath - Path to the tar.gz archive file
 * @returns Deploy response with the site URL and deployment details
 */
export async function uploadSite(archivePath: string): Promise<DeployResponse> {
  const archiveBuffer = await readFile(archivePath);
  const blob = new Blob([archiveBuffer], { type: "application/gzip" });
  const formData = new FormData();
  formData.append("file", blob, "dist.tar.gz");

  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post("deploy-dist", {
      body: formData,
      timeout: 180_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deploying site");
  }

  const result = DeployResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "There was an issue deploying your site",
      result.error,
    );
  }

  return result.data;
}

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
 * The form carries exactly one file part — `index.html`, the sentinel that
 * completes the deployment — and nothing else.
 */
export async function finalizeStaticDeployment(
  deploymentId: string,
  indexHtml: Uint8Array,
  sessionId: string,
): Promise<FinalizeDeploymentResponse> {
  const formData = new FormData();
  formData.append(
    "index.html",
    new File([indexHtml], "index.html", { type: "text/html" }),
  );
  return await postFinalize(deploymentId, formData, sessionId);
}

async function postFinalize(
  deploymentId: string,
  formData: FormData,
  sessionId: string,
): Promise<FinalizeDeploymentResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post(
      `deployments/${encodeURIComponent(deploymentId)}/finalize`,
      {
        body: formData,
        timeout: 180_000,
        searchParams: { session_id: sessionId },
      },
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
