import { dirname, join } from "node:path";
import { pathExists } from "@/core/utils/fs.js";

/** Abbreviated or full commit hash — the same pattern the server validates. */
const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export function isGitCommitHash(value: string): boolean {
  return GIT_HASH_PATTERN.test(value);
}

/** The nearest directory at or above `startPath` holding a `.git` entry (a worktree's is a file). */
export async function findGitRoot(
  startPath: string = process.cwd(),
): Promise<string | undefined> {
  let current = startPath;
  while (!(await pathExists(join(current, ".git")))) {
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return current;
}
