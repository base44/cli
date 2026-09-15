const VERSIONS_API_ENV = "BASE44_VERSIONS_API";

/**
 * Internal gate for the versions lane, not user-facing yet. With it off
 * `publish` and `versions` are not registered at all, so they are absent from
 * `--help` rather than half-integrated commands a user can stumble into.
 *
 * Not `BASE44_DEPLOYMENTS_API`: that selects the legacy transport for
 * `site deploy` and the sandbox already sets it, so one var would tie the two
 * lanes together.
 */
export function versionsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[VERSIONS_API_ENV];
  return value === "1" || value === "true";
}
