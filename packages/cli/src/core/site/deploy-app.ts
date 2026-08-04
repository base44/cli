import { resolve } from "node:path";
import { deploySite } from "@/core/site/deploy.js";
import { deployFullStack } from "./full-stack.js";
import { resolveGitHash } from "./git-hash.js";
import type { DeploymentProgress } from "./schema.js";
import { deployStaticSite, staticDeploymentsEnabled } from "./static-site.js";
import { detectFullStackArtifact } from "./wrangler-config.js";

export interface AppSiteTarget {
  root: string;
  site?: { outputDirectory?: string };
}

type AppDeployKind = "full-stack" | "static-deployment" | "static" | "none";

export type AppDeployResult =
  | { kind: "full-stack"; deploymentId: string; gitHash: string }
  | { kind: "static-deployment"; deploymentId: string; gitHash: string }
  | { kind: "static"; appUrl: string }
  | { kind: "none" };

type AppDeployPlan =
  | { kind: "full-stack" }
  | { kind: "static-deployment"; outputDir: string }
  | { kind: "static"; outputDir: string }
  | { kind: "none" };

/**
 * A full-stack artifact wins over the static output directory: it carries the
 * server too, so shipping the static output instead would silently drop the
 * worker.
 */
async function planAppDeploy(target: AppSiteTarget): Promise<AppDeployPlan> {
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

/** How the built output would ship right now — a build step invalidates it. */
export async function detectAppDeployKind(
  target: AppSiteTarget,
): Promise<AppDeployKind> {
  return (await planAppDeploy(target)).kind;
}

/**
 * Deploy the project's built output over whichever transport applies — a
 * Workers deployment addressed by commit for full-stack builds, a
 * deployments-API static deployment when the lane is enabled, the legacy tar.gz
 * upload otherwise.
 */
export async function deployAppSite(
  target: AppSiteTarget,
  options: {
    gitHash?: string;
    concurrency?: number;
    progress?: DeploymentProgress;
  } = {},
): Promise<AppDeployResult> {
  const plan = await planAppDeploy(target);

  switch (plan.kind) {
    case "full-stack": {
      const gitHash = await resolveGitHash(target.root, options.gitHash);
      const { deploymentId } = await deployFullStack({
        projectRoot: target.root,
        gitHash,
        concurrency: options.concurrency,
        progress: options.progress,
      });
      return { kind: "full-stack", deploymentId, gitHash };
    }
    case "static-deployment": {
      const gitHash = await resolveGitHash(target.root, options.gitHash);
      const { deploymentId } = await deployStaticSite({
        outputDir: plan.outputDir,
        gitHash,
        concurrency: options.concurrency,
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
