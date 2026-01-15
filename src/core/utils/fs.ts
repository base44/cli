import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  copyFile as fsCopyFile,
  mkdir,
  unlink,
  access,
} from "node:fs/promises";
import { dirname } from "node:path";
import JSON5 from "json5";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeFile(
  filePath: string,
  content: string
): Promise<void> {
  const dir = dirname(filePath);
  if (!(await pathExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  await fsWriteFile(filePath, content, "utf-8");
}

export async function copyFile(src: string, dest: string): Promise<void> {
  const dir = dirname(dest);
  if (!(await pathExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  await fsCopyFile(src, dest);
}

export async function readFile(filePath: string): Promise<Buffer> {
  if (!(await pathExists(filePath))) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    return await fsReadFile(filePath);
  } catch (error) {
    throw new Error(
      `Failed to read file ${filePath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  if (!(await pathExists(filePath))) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    const fileContent = await fsReadFile(filePath, "utf-8");
    return JSON5.parse(fileContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`File contains invalid JSON: ${filePath} (${error.message})`);
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
  const dir = dirname(filePath);
  if (!(await pathExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  const jsonContent = JSON.stringify(data, null, 2);
  await fsWriteFile(filePath, jsonContent, "utf-8");
}

export async function deleteFile(filePath: string): Promise<void> {
  if (!(await pathExists(filePath))) {
    return;
  }
  await unlink(filePath);
}
