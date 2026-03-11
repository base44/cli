import { parse } from "dotenv";
import { readTextFile } from "./fs.js";

/**
 * Parse a .env file into a Record of key-value pairs.
 */
export async function parseEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  const content = await readTextFile(filePath);
  return parse(content);
}
