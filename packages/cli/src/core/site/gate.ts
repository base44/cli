/**
 * Internal gate for the experimental static-site deployments-API lane. Read
 * exactly once, where the CLI builds its context (`CLIContext.staticDeployments`),
 * and passed down from there — no layer below the CLI edge consults the
 * environment, so a run cannot disagree with itself about which lane it is on.
 *
 * Nothing about this lane is user-facing yet: with the gate off the site deploy
 * keeps taking the legacy tar.gz path and `--git-hash` is not even registered,
 * so `--help` looks exactly as it did before this lane existed.
 */
const STATIC_DEPLOYMENTS_ENV = "BASE44_STATIC_DEPLOYMENTS";

export function staticDeploymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[STATIC_DEPLOYMENTS_ENV];
  return value === "1" || value === "true";
}
