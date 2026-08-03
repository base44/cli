import { resolve } from "node:path";
import type { DeploymentProgress } from "@/core/deployments/index.js";
import {
  deployStaticSite,
  resolveGitHash,
  staticDeploymentsEnabled,
} from "@/core/deployments/index.js";
import { deploySite } from "@/core/site/deploy.js";

/** The project fields an app deploy reads. */
export interface AppSiteTarget {
  root: string;
  site?: { outputDirectory?: string };
}

/** Which transport ships this project's built output. */
type AppDeployKind = "static-deployment" | "static" | "none";

export type AppDeployResult =
  | { kind: "static-deployment"; deploymentId: string; gitHash: string }
  | { kind: "static"; appUrl: string }
  | { kind: "none" };

type AppDeployPlan =
  | { kind: "static-deployment"; outputDir: string }
  | { kind: "static"; outputDir: string }
  | { kind: "none" };

/**
 * A static output ships through the deployments API when the lane is
 * enabled, and as the legacy tar.gz upload otherwise.
 */
async function planAppDeploy(target: AppSiteTarget): Promise<AppDeployPlan> {
  const outputDirectory = target.site?.outputDirectory;
  if (!outputDirectory) {
    return { kind: "none" };
  }
  const outputDir = resolve(target.root, outputDirectory);
  return staticDeploymentsEnabled()
    ? { kind: "static-deployment", outputDir }
    : { kind: "static", outputDir };
}

/**
 * How the project's built output would ship right now. This only answers for
 * the current state of the tree — call it again after any build step.
 */
export async function detectAppDeployKind(
  target: AppSiteTarget,
): Promise<AppDeployKind> {
  return (await planAppDeploy(target)).kind;
}

/**
 * Deploy the project's built output over whichever transport applies —
 * a deployments-API static deployment when the lane is enabled, the legacy
 * tar.gz upload otherwise. Returns `{ kind: "none" }` when the project has
 * nothing to ship.
 */
export async function deployAppSite(
  target: AppSiteTarget,
  options: { gitHash?: string; progress?: DeploymentProgress } = {},
): Promise<AppDeployResult> {
  const plan = await planAppDeploy(target);

  switch (plan.kind) {
    case "static-deployment": {
      const gitHash = await resolveGitHash(target.root, options.gitHash);
      const { deploymentId } = await deployStaticSite({
        outputDir: plan.outputDir,
        gitHash,
        progress: options.progress,
      });
      return { kind: "static-deployment", deploymentId, gitHash };
    }
    case "static": {
      const { appUrl } = await deploySite(plan.outputDir);
      return { kind: "static", appUrl };
    }
    case "none":
      return { kind: "none" };
  }
}
