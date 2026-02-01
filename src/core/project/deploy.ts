import { resolve } from "node:path";
import { pushEntities } from "@/core/resources/entity/index.js";
import { pushFunctions } from "@/core/resources/function/index.js";
import { pushAgents } from "@/core/resources/agent/index.js";
import { deploySite } from "@/core/site/index.js";
import type { ProjectData } from "@/core/project/types.js";

/**
 * Checks if there are any resources to deploy in the project.
 *
 * @param projectData - The project configuration and resources
 * @returns true if there are entities, functions, agents, or a configured site to deploy
 */
export function hasResourcesToDeploy(projectData: ProjectData): boolean {
  const { project, entities, functions, agents } = projectData;
  const hasSite = Boolean(project.site?.outputDirectory);
  const hasEntities = entities.length > 0;
  const hasFunctions = functions.length > 0;
  const hasAgents = agents.length > 0;

  return hasEntities || hasFunctions || hasAgents || hasSite;
}

/**
 * Result of deploying all project resources.
 */
export interface DeployAllResult {
  /**
   * The app URL if a site was deployed, undefined otherwise.
   */
  appUrl?: string;
}

/**
 * Deploys all project resources (entities, functions, agents, and site) to Base44.
 *
 * @param projectData - The project configuration and resources to deploy
 * @returns The deployment result including app URL if site was deployed
 */
export async function deployAll(
  projectData: ProjectData
): Promise<DeployAllResult> {
  const { project, entities, functions, agents } = projectData;

  await pushEntities(entities);
  await pushFunctions(functions);
  await pushAgents(agents);

  if (project.site?.outputDirectory) {
    const outputDir = resolve(project.root, project.site.outputDirectory);
    const { appUrl } = await deploySite(outputDir);
    return { appUrl };
  }

  return {};
}
