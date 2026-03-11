import { globby } from "globby";

/**
 * Gets all file paths in the output directory.
 * Used to check if the directory contains any files before deployment.
 *
 * @param outputDir - The directory containing built site files
 * @returns Array of relative file paths
 */
export async function getSiteFilePaths(outputDir: string): Promise<string[]> {
  return await globby("**/*", {
    cwd: outputDir,
    onlyFiles: true,
    absolute: false,
  });
}
