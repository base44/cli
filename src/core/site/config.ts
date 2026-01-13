import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { globby } from "globby";
import type { SiteFile } from "./schema.js";

/**
 * Reads all files from a site output directory and encodes them as base64.
 *
 * @param outputDir - The directory containing built site files (e.g., "dist")
 * @returns Array of SiteFile objects with relative paths and base64 content
 *
 * @example
 * const files = await readSiteFiles("./dist");
 * // files = [{ path: "index.html", content: "PGh0bWw+..." }, ...]
 */
export async function readSiteFiles(outputDir: string): Promise<SiteFile[]> {
  // Glob all files (not directories) in the output directory
  const filePaths = await globby("**/*", {
    cwd: outputDir,
    onlyFiles: true,
    absolute: false,
  });

  if (filePaths.length === 0) {
    return [];
  }

  // Read each file and encode as base64
  const files = await Promise.all(
    filePaths.map(async (relativePath): Promise<SiteFile> => {
      const absolutePath = join(outputDir, relativePath);
      const buffer = await readFile(absolutePath);
      const content = buffer.toString("base64");

      return {
        path: relativePath,
        content,
      };
    })
  );

  return files;
}
