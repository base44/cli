import type { DeployResponse } from "./schema.js";
import { readSiteFiles } from "./config.js";
import { uploadSite } from "./api.js";

/**
 * Deploys a site from the given output directory to Base44 hosting.
 * Reads all files, validates, and uploads to the API.
 *
 * @param outputDir - The directory containing built site files (e.g., "./dist")
 * @returns Deploy response with the site URL
 * @throws Error if no files found in the output directory
 *
 * @example
 * const { url } = await deploySite("./dist");
 * console.log(`Deployed to: ${url}`);
 */
export async function deploySite(outputDir: string): Promise<DeployResponse> {
  const files = await readSiteFiles(outputDir);

  if (files.length === 0) {
    throw new Error(
      `No files found in output directory: ${outputDir}. Make sure to build your project first.`
    );
  }

  return await uploadSite(files);
}
