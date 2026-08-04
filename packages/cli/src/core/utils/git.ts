/** Abbreviated or full commit hash — the same pattern the server validates. */
const GIT_HASH_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export function isGitCommitHash(value: string): boolean {
  return GIT_HASH_PATTERN.test(value);
}
