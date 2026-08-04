import { execa } from "execa";

/**
 * A git commit hash: 7–64 hex chars, abbreviated or full. The deployments API
 * validates commit addresses with the same pattern.
 */
const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export function isGitCommitHash(value: string): boolean {
  return GIT_HASH_PATTERN.test(value);
}

/** The commit checked out at `cwd`, or null when it is not a git checkout. */
export async function getGitHead(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}
