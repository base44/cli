import { InvalidArgumentError } from "commander";
import { isGitCommitHash } from "@/core/utils/git.js";

/** Commander argParser for a `--git-hash` flag. */
export function parseGitHash(value: string): string {
  if (!isGitCommitHash(value)) {
    throw new InvalidArgumentError(
      "Expected a git commit hash (7-64 hex chars).",
    );
  }
  return value;
}
