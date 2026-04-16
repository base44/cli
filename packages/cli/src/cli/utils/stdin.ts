import { InvalidInputError } from "@/core/errors.js";

/**
 * Reads all data from stdin and returns it as a trimmed string.
 * Throws if stdin is a TTY (i.e., nothing is piped).
 */
export async function readStdin(flagName = "--stdin"): Promise<string> {
  if (process.stdin.isTTY) {
    throw new InvalidInputError(
      `${flagName} requires piped input (e.g., echo <value> | base44 ...)`,
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
