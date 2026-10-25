import { execa } from "execa";

/** Abbreviated or full commit hash — the same pattern the server validates. */
const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export function isGitCommitHash(value: string): boolean {
  return GIT_HASH_PATTERN.test(value);
}

interface GitState {
  /** The checked-out branch; undefined when HEAD is detached. */
  branch?: string;
  /** Uncommitted changes, or a branch whose commits aren't all on its remote. */
  unpushed: boolean;
}

/** The checkout's branch and whether it has work its remote lacks; undefined outside a git checkout. */
export async function readGitState(cwd: string): Promise<GitState | undefined> {
  const status = await execa("git", ["status", "--porcelain", "--branch"], {
    cwd,
    reject: false,
  });
  if (status.exitCode !== 0) return undefined;
  const [header = "", ...changes] = status.stdout.split("\n").filter(Boolean);
  const head = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    reject: false,
  });
  const branch =
    head.exitCode === 0 && head.stdout !== "HEAD" ? head.stdout : undefined;
  // "## main...origin/main [ahead 1]". No "..." means no upstream; "[gone]"
  // means the upstream was deleted. Both leave the branch off the remote.
  const offRemote =
    branch !== undefined &&
    (!header.includes("...") || /\[(ahead|gone)/.test(header));
  return { branch, unpushed: changes.length > 0 || offRemote };
}
