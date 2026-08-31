import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  CreateDeploymentRequest,
  CreateDeploymentResponse,
  DeployResponse,
  FinalizeDeploymentResponse,
  ModuleType,
  WorkerModule,
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
 * What completes a deployment — the one thing the two kinds of build send
 * differently. A build that produced a worker completes with its modules and
 * the asset completion token; a plain static build completes with the
 * `index.html` sentinel, which is the whole form and carries no payload part.
 */
type FinalizePayload =
  | { modules: WorkerModule[]; completionJwt: string | null }
  | { indexHtml: Uint8Array };

export async function finalizeDeployment(
  deploymentId: string,
  sessionId: string,
  payload: FinalizePayload,
): Promise<FinalizeDeploymentResponse> {
  const formData = new FormData();

  if ("indexHtml" in payload) {
    formData.append(
      "index.html",
      new File([payload.indexHtml], "index.html", { type: "text/html" }),
    );
  } else {
    formData.append(
      "payload",
      JSON.stringify({ completion_jwt: payload.completionJwt }),
    );
    for (const module of payload.modules) {
      const content = await readFile(module.absolutePath);
      formData.append(
        module.name,
        new File([new Uint8Array(content)], module.name, {
          type: MODULE_CONTENT_TYPES[module.type],
        }),
      );
    }
  }

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
