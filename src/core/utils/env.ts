import { readFile } from "node:fs/promises";
import { parse } from "dotenv";

/**
 * Parse a .env file into a Record of key-value pairs.
 */
export async function parseEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  const content = await readFile(filePath, "utf-8");
  return parse(content);
}
