import { resolve } from "node:path";
import { deploySite } from "@/core/site/deploy.js";
import type { DeploymentProgress } from "./schema.js";
import { deployStaticSite } from "./static-site.js";

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

/**
 * Whether the deployments-API lane is on for this run. The gate is read once
 * at the CLI edge (`CLIContext.staticDeployments`) and passed down — core is
 * told which transport to use and never reads the environment itself.
 */
interface StaticDeploymentsOption {
  staticDeployments?: boolean;
}

type AppDeployPlan =
  | { kind: "static-deployment"; outputDir: string }
  | { kind: "static"; outputDir: string }
  | { kind: "none" };

/**
 * A static output ships through the deployments API when the lane is
 * enabled, and as the legacy tar.gz upload otherwise.
 */
function planAppDeploy(
  target: AppSiteTarget,
  staticDeployments: boolean,
): AppDeployPlan {
  const outputDirectory = target.site?.outputDirectory;
  if (!outputDirectory) {
    return { kind: "none" };
  }
  const outputDir = resolve(target.root, outputDirectory);
  return staticDeployments
    ? { kind: "static-deployment", outputDir }
    : { kind: "static", outputDir };
}

/**
 * How the project's built output would ship right now. This only answers for
 * the current state of the tree — call it again after any build step.
 */
export function detectAppDeployKind(
  target: AppSiteTarget,
  options: StaticDeploymentsOption = {},
): AppDeployKind {
  return planAppDeploy(target, options.staticDeployments ?? false).kind;
}

/**
 * Deploy the project's built output over whichever transport applies —
 * a deployments-API static deployment when the lane is enabled, the legacy
 * tar.gz upload otherwise. Returns `{ kind: "none" }` when the project has
 * nothing to ship.
 */
export async function deployAppSite(
  target: AppSiteTarget,
  options: StaticDeploymentsOption & {
    gitHash?: string;
    progress?: DeploymentProgress;
  } = {},
): Promise<AppDeployResult> {
  const plan = planAppDeploy(target, options.staticDeployments ?? false);

  switch (plan.kind) {
    case "static-deployment": {
      const { deploymentId, gitHash } = await deployStaticSite({
        outputDir: plan.outputDir,
        projectRoot: target.root,
        gitHash: options.gitHash,
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
