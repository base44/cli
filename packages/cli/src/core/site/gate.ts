/**
 * Internal gate for the experimental static-site deployments-API lane, not
 * user-facing yet. Read once into `CLIContext.staticDeployments` and passed
 * down from there — no layer below the CLI edge consults the environment.
 */
const STATIC_DEPLOYMENTS_ENV = "BASE44_STATIC_DEPLOYMENTS";

export function staticDeploymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[STATIC_DEPLOYMENTS_ENV];
  return value === "1" || value === "true";
}
