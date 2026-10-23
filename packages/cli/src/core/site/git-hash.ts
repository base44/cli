import { execa } from "execa";
import { InvalidInputError } from "@/core/errors.js";
import { isGitCommitHash } from "@/core/utils/git.js";

/** A worker build has no archive form, so it can only ship by the commit it came from. */
export function workerBuildNeedsGitHashError(): InvalidInputError {
  return new InvalidInputError(
    "A full-stack build deploys by the commit that produced it, and none was given.",
    {
      hints: [
        {
          message:
            "Pass it with --git-hash, e.g. --git-hash $(git rev-parse HEAD).",
        },
      ],
    },
  );
}

/**
 * The commit this build came from, or `undefined` when there is none.
 *
 * For a version the commit is PROVENANCE — recorded, never hashed, and not part
 * of what the version is — so a build outside a checkout is still a complete
 * version, and the local checkout is a fair default.
 */
export async function resolveProvenanceCommit(
  projectRoot: string,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) {
    if (!isGitCommitHash(explicit)) {
      throw new InvalidInputError(`'${explicit}' is not a git commit hash.`);
    }
    return explicit;
  }
  const hash = await gitHead(projectRoot);
  return hash && isGitCommitHash(hash) ? hash : undefined;
}

async function gitHead(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}
