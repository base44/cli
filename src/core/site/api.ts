import { getAppClient, base44Client } from "@/core/clients/index.js";
import { getAppConfig } from "@/core/project/index.js";
import { readFile } from "@/core/utils/fs.js";
import { DeployResponseSchema, PublishedUrlResponseSchema } from "@/core/site/schema.js";
import type { DeployResponse } from "@/core/site/schema.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

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

  let response;
  try {
    response = await appClient.post("deploy-dist", {
      body: formData,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deploying site");
  }

  const result = DeployResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("There was an issue deploying your site", result.error);
  }

  return result.data;
}

export async function getSiteUrl(projectId?: string): Promise<string> {
  const id = projectId ?? getAppConfig().id;

  let response;
  try {
    response = await base44Client.get(`api/apps/platform/${id}/published-url`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching site URL");
  }

  const result = PublishedUrlResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data.url;
}
