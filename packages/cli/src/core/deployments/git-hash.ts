import { execa } from "execa";
import { InvalidInputError } from "@/core/errors.js";
import { GIT_HASH_PATTERN } from "./schema.js";

/**
 * The commit this build came from — a deployment is addressed by it, so the
 * hash is required. An explicit hash (flag/automation) wins; otherwise it
 * comes from the git checkout at the project root.
 */
export async function resolveGitHash(
  projectRoot: string,
  explicit?: string,
): Promise<string> {
  const hash = explicit ?? (await gitHead(projectRoot));
  if (!hash || !GIT_HASH_PATTERN.test(hash)) {
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
