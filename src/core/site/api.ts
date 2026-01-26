import { getAppClient } from "@/core/clients/index.js";
import { readFile } from "@/core/utils/fs.js";
import { DeployResponseSchema } from "@/core/site/schema.js";
import type { DeployResponse } from "@/core/site/schema.js";

/**
 * Uploads a tar.gz archive file to the Base44 hosting API.
 *
 * @param archivePath - Path to the tar.gz archive file
 * @returns Deploy response with the site URL and deployment details
 * @throws Error if file read or upload fails
 */
export async function uploadSite(archivePath: string): Promise<DeployResponse> {
  const archiveBuffer = await readFile(archivePath);
  const blob = new Blob([archiveBuffer], { type: "application/gzip" });
  const formData = new FormData();
  formData.append("file", blob, "dist.tar.gz");

  const appClient = getAppClient();
  const response = await appClient.post("deploy-dist", {
    body: formData,
  });

  const result = DeployResponseSchema.parse(await response.json());

  return result;
}
