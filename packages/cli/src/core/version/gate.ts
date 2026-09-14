const VERSIONS_API_ENV = "BASE44_VERSIONS_API";

/**
 * Internal gate for the versions lane — `base44 publish` and the `versions`
 * group, neither user-facing yet. With it off the commands are **not registered
 * at all**, so they are absent from `--help` and typing one is an unknown
 * command, rather than a half-integrated lane a user can stumble into.
 *
 * Deliberately not `BASE44_DEPLOYMENTS_API`: that one selects the legacy
 * deployments transport for `site deploy`, and the build sandbox already sets it
 * for that arm. One var switching both lanes would make them impossible to roll
 * out apart.
 *
 * `base44 build` is NOT gated. It is a pre-existing public command, and what
 * changed there — no credential, and config defaults for a repo that has none —
 * is what lets the sandbox build before it holds a publish key.
 */
export function versionsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[VERSIONS_API_ENV];
  return value === "1" || value === "true";
}
