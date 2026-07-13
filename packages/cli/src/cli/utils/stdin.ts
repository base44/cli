import { InvalidInputError } from "@/core/errors.js";

/**
 * Reads all data from stdin and returns it as a string.
 * Throws if stdin is a TTY (i.e., nothing is piped).
 *
 * @param flagName - Name shown in the error message when nothing is piped.
 * @param options.trim - Trim surrounding whitespace (default true). Pass
 *   `false` to preserve content verbatim (e.g. file bodies / trailing newlines).
 */
export async function readStdin(
  flagName = "--stdin",
  options: { trim?: boolean } = {},
): Promise<string> {
  if (process.stdin.isTTY) {
    throw new InvalidInputError(
      `${flagName} requires piped input (e.g., echo <value> | base44 ...)`,
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  return options.trim === false ? text : text.trim();
}
