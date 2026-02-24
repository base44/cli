import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";

/**
 * Parse a .env file into a Record of key-value pairs.
 */
export async function parseEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  const content = await readFile(resolve(filePath), "utf-8");
  return parse(content);
}
