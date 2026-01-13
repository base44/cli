import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { globby } from "globby";
import type { SiteFile } from "./schema.js";

async function readSiteFile(
  outputDir: string,
  relativePath: string
): Promise<SiteFile> {
  const absolutePath = join(outputDir, relativePath);
  const buffer = await readFile(absolutePath);
  const content = buffer.toString("base64");

  await new Promise((resolve) => setTimeout(resolve, 20));

  return {
    path: relativePath,
    content,
  };
}

export async function getSiteFilePaths(outputDir: string): Promise<string[]> {
  return await globby("**/*", {
    cwd: outputDir,
    onlyFiles: true,
    absolute: false,
  });
}

/**
 * Reads site files one by one, yielding each file as it's read.
 * Useful for showing progress during file reading.
 *
 * @param outputDir - The directory containing built site files
 * @param filePaths - Array of relative file paths to read
 * @yields Each file as it's read
 *
 * @example
 * const paths = await getSiteFilePaths("./dist");
 * for await (const file of readSiteFilesStream("./dist", paths)) {
 *   console.log(`Read: ${file.path}`);
 * }
 */
export async function* readSiteFilesStream(
  outputDir: string,
  filePaths: string[]
): AsyncGenerator<SiteFile> {
  for (const relativePath of filePaths) {
    yield await readSiteFile(outputDir, relativePath);
  }
}
