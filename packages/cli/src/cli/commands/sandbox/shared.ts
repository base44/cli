import { readStdin } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";

// Re-exported from the shared util so both sandbox and workspace commands use
// one implementation of the `--json` serializer.
export { toJsonStdout } from "@/cli/utils/index.js";

export const CHECKPOINT_HELP = `
Writes are committed but not checkpointed. Only checkpoints appear in the
builder's version history, and a Restore or Revert there rolls the app back to
the last checkpoint and discards everything written after it. Run
\`base44 sandbox checkpoint\` when you finish a unit of work and before you stop.`;

/**
 * Resolve a payload that may come from a flag or piped stdin.
 * Returns the flag value when set, otherwise reads stdin (without trimming, so
 * file content and trailing newlines are preserved). Throws if neither is given.
 */
export async function resolveFlagOrStdin(
  flagValue: string | undefined,
  flagName: string,
): Promise<string> {
  if (flagValue !== undefined) {
    return flagValue;
  }
  if (process.stdin.isTTY) {
    throw new InvalidInputError(
      `Provide ${flagName} or pipe the value via stdin (e.g. echo <value> | base44 sandbox ...).`,
    );
  }
  return readStdin(flagName, { trim: false });
}

/**
 * Parse a CLI option string as a positive integer, or return undefined when
 * the option was not provided. Throws InvalidInputError on a malformed value.
 */
export function parsePositiveInt(
  value: string | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidInputError(`${flagName} must be a positive integer.`);
  }
  return n;
}
