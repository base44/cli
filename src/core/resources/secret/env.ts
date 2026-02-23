import { readFile } from "node:fs/promises";

/**
 * Parse a .env file into a Record of key-value pairs.
 * - Skips empty lines and lines starting with #
 * - Splits on the first = (values may contain =)
 * - Trims keys, preserves value whitespace
 * - Duplicate keys: last value wins (standard .env convention)
 */
export async function parseEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  const content = await readFile(filePath, "utf-8");
  const secrets: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1);

    if (key) {
      secrets[key] = value;
    }
  }

  return secrets;
}
