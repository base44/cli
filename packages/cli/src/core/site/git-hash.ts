import { execa } from "execa";
import { InvalidInputError } from "@/core/errors.js";
import { isGitCommitHash } from "@/core/utils/git.js";

export async function resolveGitHash(
  projectRoot: string,
  explicit?: string,
): Promise<string> {
  const hash = explicit ?? (await gitHead(projectRoot));
  if (!hash || !isGitCommitHash(hash)) {
    throw new InvalidInputError(
      explicit
        ? `'${explicit}' is not a git commit hash.`
        : "Deployments are addressed by the commit that produced the build, and no git commit was found.",
      {
        hints: [
          {
            message:
              "Run the deploy from a git checkout, or pass the commit explicitly with --git-hash.",
          },
        ],
      },
    );
  }
  return hash;
}

/**
 * The commit this build came from, or `null` when there is none.
 *
 * For a version the commit is PROVENANCE — recorded, never hashed, and not part
 * of what the version is — so a build outside a checkout is still a complete
 * version. That is the whole difference from {@link resolveGitHash}, whose
 * caller addresses a deployment BY the hash and so cannot go without one.
 */
export async function resolveProvenanceCommit(
  projectRoot: string,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) {
    return await resolveGitHash(projectRoot, explicit);
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
