import { resolve } from "node:path";
import { detectFullStackArtifact } from "./wrangler-config.js";

/**
 * Internal gate for the experimental static-site deployments-API lane, not
 * user-facing yet: with it off, a static output keeps taking the legacy tar.gz
 * upload. A build carrying a worker is never gated — a tarball cannot ship one.
 */
const STATIC_DEPLOYMENTS_ENV = "BASE44_STATIC_DEPLOYMENTS";

function staticDeploymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[STATIC_DEPLOYMENTS_ENV];
  return value === "1" || value === "true";
}

interface AppSiteTarget {
  root: string;
  site?: { outputDirectory?: string };
}

/** Which transport ships this project's built output. */
type AppDeployPlan =
  | { kind: "deployment"; outputDir: string | null }
  | { kind: "tarball"; outputDir: string }
  | { kind: "none" };

/**
 * How the built output would ship right now. A build that produced a worker
 * always goes through the deployments API: the worker is the server, and a
 * tar.gz of the static output would silently drop it. Such a build also brings
 * its own assets directory, so it needs no site.outputDirectory.
 *
 * The artifact is itself a build output, so a build step invalidates the answer
 * — plan again after one runs.
 */
export async function planAppDeploy(
  target: AppSiteTarget,
): Promise<AppDeployPlan> {
  const outputDirectory = target.site?.outputDirectory;
  const outputDir = outputDirectory
    ? resolve(target.root, outputDirectory)
    : null;

  if (await detectFullStackArtifact(target.root)) {
    return { kind: "deployment", outputDir };
  }
  if (!outputDir) {
    return { kind: "none" };
  }
  return staticDeploymentsEnabled()
    ? { kind: "deployment", outputDir }
    : { kind: "tarball", outputDir };
}
