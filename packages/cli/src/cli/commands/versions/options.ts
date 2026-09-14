import { InvalidArgumentError, Option } from "commander";
import { isGitCommitHash } from "@/core/utils/git.js";
import {
  DEFAULT_VERSION_UPLOAD_CONCURRENCY,
  MAX_VERSION_UPLOAD_CONCURRENCY,
} from "@/core/version/index.js";

/**
 * The options the versions lane's commands share.
 *
 * Built here rather than repeated per command so `publish --help` and
 * `versions create --help` cannot describe the same flag differently, and so a
 * change to what is accepted lands in one place.
 */

export function outputDirOption(): Option {
  return new Option(
    "--output-dir <dir>",
    "Build output directory (defaults to the project's, else dist)",
  );
}

export function targetOption(): Option {
  return new Option("--target <name>", "Environment to serve the version at");
}

export function gitHashOption(): Option {
  return new Option(
    "--git-hash <hash>",
    "Commit the build came from (defaults to the checkout's HEAD)",
  ).argParser((value) => {
    if (!isGitCommitHash(value)) {
      throw new InvalidArgumentError(
        "Expected a git commit hash (7-64 hex chars).",
      );
    }
    return value;
  });
}

export function concurrencyOption(): Option {
  return new Option("--concurrency <n>", "Parallel file uploads")
    .default(DEFAULT_VERSION_UPLOAD_CONCURRENCY)
    .argParser((value) => {
      const parsed = Number(value);
      if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_VERSION_UPLOAD_CONCURRENCY
      ) {
        throw new InvalidArgumentError(
          `Expected a whole number between 1 and ${MAX_VERSION_UPLOAD_CONCURRENCY}.`,
        );
      }
      return parsed;
    });
}
