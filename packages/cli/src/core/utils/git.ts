import { execa } from "execa";

/** Abbreviated or full commit hash — the same pattern the server validates. */
const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export function isGitCommitHash(value: string): boolean {
  return GIT_HASH_PATTERN.test(value);
}

/** True when the checkout at `cwd` has uncommitted changes or commits its remote lacks. */
export async function hasUnpushedWork(cwd: string): Promise<boolean> {
  const status = await execa("git", ["status", "--porcelain", "--branch"], {
    cwd,
    reject: false,
  });
  if (status.exitCode !== 0) return false;
  const [branch = "", ...changes] = status.stdout.split("\n").filter(Boolean);
  // "## main...origin/main [ahead 1]"; a branch with no upstream has no "...".
  return (
    changes.length > 0 || !branch.includes("...") || branch.includes("[ahead")
  );
}
