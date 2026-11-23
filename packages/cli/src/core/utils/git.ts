import { execa } from "execa";

/** Abbreviated or full commit hash — the same pattern the server validates. */
const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export function isGitCommitHash(value: string): boolean {
  return GIT_HASH_PATTERN.test(value);
}

/** The checked-out branch; undefined when HEAD is detached or outside a git checkout. */
export async function readGitBranch(cwd: string): Promise<string | undefined> {
  const head = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    reject: false,
  });
  return head.exitCode === 0 && head.stdout !== "HEAD"
    ? head.stdout
    : undefined;
}
