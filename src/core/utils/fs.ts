import { readFile, writeFile, mkdir, unlink, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { ParseError } from "jsonc-parser";
import { parse, printParseErrorCode } from "jsonc-parser";

export function pathExists(path: string) {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  if (!(await pathExists(filePath))) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    const fileContent = await readFile(filePath, "utf-8");
    const errors: ParseError[] = [];
    const result = parse(fileContent, errors, { allowTrailingComma: true });

    if (errors.length > 0) {
      const errorMessages = errors
        .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
        .join(", ");
      throw new Error(
        `File contains invalid JSONC: ${filePath} (${errorMessages})`
      );
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid JSONC")) {
      throw error;
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
    if (!(await pathExists(dir))) {
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
  if (!(await pathExists(filePath))) {
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
