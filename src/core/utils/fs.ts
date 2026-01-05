import { existsSync } from "fs";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { dirname } from "path";

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  if (!fileExists(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    const fileContent = await readFile(filePath, "utf-8");
    return JSON.parse(fileContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`File contains invalid JSON: ${filePath}`);
    }
    throw new Error(
      `Failed to read file ${filePath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function writeJsonFile(
  filePath: string,
  data: unknown
): Promise<void> {
  try {
    const dir = dirname(filePath);
    if (!fileExists(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const jsonContent = JSON.stringify(data, null, 2);
    await writeFile(filePath, jsonContent, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to write file ${filePath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  if (!fileExists(filePath)) {
    return;
  }

  try {
    await unlink(filePath);
  } catch (error) {
    throw new Error(
      `Failed to delete file ${filePath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

