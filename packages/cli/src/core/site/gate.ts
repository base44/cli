/**
 * Internal gate for the experimental static-site deployments-API lane, not
 * user-facing yet. It decides whether `--git-hash` is registered at all; the
 * flag being passed is what routes a deploy through the deployments API.
 */
const STATIC_DEPLOYMENTS_ENV = "BASE44_STATIC_DEPLOYMENTS";

export function staticDeploymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[STATIC_DEPLOYMENTS_ENV];
  return value === "1" || value === "true";
}
