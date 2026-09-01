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
