import { resolve } from "node:path";
import { staticDeploymentsEnabled } from "./static-site.js";
import { detectFullStackArtifact } from "./wrangler-config.js";

interface AppSiteTarget {
  root: string;
  site?: { outputDirectory?: string };
}

/** Which transport ships this project's built output. */
type AppDeployPlan =
  | { kind: "full-stack" }
  | { kind: "static-deployment"; outputDir: string }
  | { kind: "static"; outputDir: string }
  | { kind: "none" };

/**
 * How the built output would ship right now. A full-stack artifact wins over the
 * static output directory: it carries the server too, so shipping the static
 * output instead would silently drop the worker.
 *
 * The artifact is itself a build output, so a build step invalidates the answer
 * — plan again after one runs.
 */
export async function planAppDeploy(
  target: AppSiteTarget,
): Promise<AppDeployPlan> {
  if (await detectFullStackArtifact(target.root)) {
    return { kind: "full-stack" };
  }
  const outputDirectory = target.site?.outputDirectory;
  if (!outputDirectory) {
    return { kind: "none" };
  }
  const outputDir = resolve(target.root, outputDirectory);
  return staticDeploymentsEnabled()
    ? { kind: "static-deployment", outputDir }
    : { kind: "static", outputDir };
}
