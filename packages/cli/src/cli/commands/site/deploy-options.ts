import { InvalidArgumentError, Option } from "commander";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  MAX_UPLOAD_CONCURRENCY,
} from "@/core/site/index.js";
import { isGitCommitHash } from "@/core/utils/git.js";

/**
 * The deployment flags shared by `base44 deploy` and `base44 site deploy`.
 * Both ship the project's built output through the same path, so the commit
 * address and the upload concurrency have to mean the same thing on each.
 */
export function addDeploymentOptions<
  T extends { addOption: (option: Option) => T },
>(command: T): T {
  return command
    .addOption(
      new Option(
        "--git-hash <hash>",
        "Commit the build came from (defaults to the checkout's HEAD)",
      ).argParser(parseGitHash),
    )
    .addOption(
      new Option("--concurrency <n>", "Parallel asset uploads")
        .default(DEFAULT_UPLOAD_CONCURRENCY)
        .argParser(parseConcurrency),
    );
}

function parseGitHash(value: string): string {
  if (!isGitCommitHash(value)) {
    throw new InvalidArgumentError(
      "Expected a git commit hash (7-64 hex chars).",
    );
  }
  return value;
}

function parseConcurrency(value: string): number {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_UPLOAD_CONCURRENCY
  ) {
    throw new InvalidArgumentError(
      `Expected a whole number between 1 and ${MAX_UPLOAD_CONCURRENCY}.`,
    );
  }
  return parsed;
}
