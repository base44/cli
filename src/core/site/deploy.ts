import type { SiteFile, DeployResponse } from "./schema.js";
import { getSiteFilePaths, readSiteFilesStream } from "./config.js";
import { uploadSite } from "./api.js";

export interface DeploySiteProgress {
  total: number;
  current: number;
  path: string;
}

/**
 * Deploys a site from the given output directory to Base44 hosting.
 * Reads files one by one with progress callback, validates, and uploads to the API.
 *
 * @param outputDir - The directory containing built site files (e.g., "./dist")
 * @param onProgress - Optional callback called for each file read
 * @returns Deploy response with the site URL
 * @throws Error if no files found in the output directory
 *
 * @example
 * const { url } = await deploySite("./dist", (progress) => {
 *   console.log(`Reading ${progress.current}/${progress.total}: ${progress.path}`);
 * });
 */
export async function deploySite(
  outputDir: string,
  onProgress?: (progress: DeploySiteProgress) => void
): Promise<DeployResponse> {
  const filePaths = await getSiteFilePaths(outputDir);

  if (filePaths.length === 0) {
    throw new Error(
      `No files found in output directory: ${outputDir}. Make sure to build your project first.`
    );
  }

  const files: SiteFile[] = [];
  let current = 0;

  for await (const file of readSiteFilesStream(outputDir, filePaths)) {
    current++;
    onProgress?.({
      total: filePaths.length,
      current,
      path: file.path,
    });
    files.push(file);
  }

  return await uploadSite(files);
}
