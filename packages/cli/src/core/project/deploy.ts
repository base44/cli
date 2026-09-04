import { resolve } from "node:path";
import { hasWorkspaceApiKeyAuth } from "@/core/auth/config.js";
import { setAppVisibility } from "@/core/project/api.js";
import type { Visibility } from "@/core/project/schema.js";
import type { ProjectData } from "@/core/project/types.js";
import { pushAgents } from "@/core/resources/agent/index.js";
import { pushAgentSkills } from "@/core/resources/agent-skill/index.js";
import { authConfigResource } from "@/core/resources/auth-config/index.js";
import {
  type ConnectorSyncResult,
  pushConnectors,
} from "@/core/resources/connector/index.js";
import { pushEntities } from "@/core/resources/entity/index.js";
import {
  deployFunctionsSequentially,
  type SingleFunctionDeployResult,
} from "@/core/resources/function/deploy.js";
import { deploySite } from "@/core/site/index.js";

/**
 * Checks if there are any resources to deploy in the project.
 *
 * @param projectData - The project configuration and resources
 * @returns true if there are entities, functions, agents, connectors, or a configured site to deploy
 */
export function hasResourcesToDeploy(projectData: ProjectData): boolean {
  const {
    project,
    entities,
    functions,
    agents,
    agentSkills,
    connectors,
    authConfig,
  } = projectData;
  const hasSite = Boolean(project.site?.outputDirectory);
  const hasEntities = entities.length > 0;
  const hasFunctions = functions.length > 0;
  const hasAgents = agents.length > 0;
  const hasAgentSkills = agentSkills.length > 0;
  const hasConnectors = connectors.length > 0;
  const hasAuthConfig = authConfig.length > 0;
  const hasVisibility = Boolean(project.visibility);

  return (
    hasEntities ||
    hasFunctions ||
    hasAgents ||
    hasAgentSkills ||
    hasConnectors ||
    hasAuthConfig ||
    hasVisibility ||
    hasSite
  );
}

/**
 * Outcome of one resource's full sync: the names the server reported as
 * created, updated and — crucially — deleted because they were absent locally.
 */
export interface ResourceSyncOutcome {
  created: string[];
  updated: string[];
  deleted: string[];
}

/**
 * Full-sync outcomes for the resources `deploy` replaces wholesale, keyed by
 * the label shown to the user. Deploy is a destructive sync: anything the
 * server holds that is missing locally is removed, so these results — the only
 * record of what was removed — must reach the caller instead of being dropped.
 */
export interface DeploySyncResults {
  entities?: ResourceSyncOutcome;
  agentSkills?: ResourceSyncOutcome;
  agents?: ResourceSyncOutcome;
}

/**
 * Result of deploying all project resources.
 */
interface DeployAllResult {
  /**
   * The app URL if a site was deployed, undefined otherwise.
   */
  appUrl?: string;
  /**
   * Results of connector push, including any that need OAuth.
   */
  connectorResults?: ConnectorSyncResult[];
  /**
   * What each full-synced resource actually created, updated and deleted.
   */
  syncResults: DeploySyncResults;
}

interface DeployAllOptions {
  onFunctionStart?: (names: string[]) => void;
  onFunctionResult?: (result: SingleFunctionDeployResult) => void;
  onVisibilitySet?: (visibility: Visibility) => void;
}

/**
 * Deploys all project resources (entities, functions, agents, connectors, and site) to Base44.
 *
 * @param projectData - The project configuration and resources to deploy
 * @param options - Optional progress callbacks for resource deployment
 * @returns The deployment result including app URL if site was deployed
 */
export async function deployAll(
  projectData: ProjectData,
  options?: DeployAllOptions,
): Promise<DeployAllResult> {
  const {
    project,
    entities,
    functions,
    agents,
    agentSkills,
    connectors,
    authConfig,
  } = projectData;

  await setAppVisibility(project.visibility);
  if (project.visibility) {
    options?.onVisibilitySet?.(project.visibility);
  }
  const syncResults: DeploySyncResults = {};

  syncResults.entities = await pushEntities(entities);
  await deployFunctionsSequentially(functions, {
    onStart: options?.onFunctionStart,
    onResult: options?.onFunctionResult,
  });
  syncResults.agentSkills = await pushAgentSkills(agentSkills);
  // A project that defines no agents is not asking `deploy` to delete the
  // app's agents — deploy covers the whole project, so an absent resource
  // means "nothing to say about agents", not "remove them all". The explicit
  // delete-all path is `base44 agents push`, which warns and confirms first.
  if (agents.length > 0) {
    syncResults.agents = await pushAgents(agents);
  }
  await authConfigResource.push(authConfig);
  // pushConnectors also reconciles: with an empty list it removes remote
  // connectors that are no longer configured locally. Only skip that when a
  // workspace API key is in use, since those principals get a 403 on the
  // connectors-list endpoint. OAuth users must still reconcile removals.
  const skipConnectorSync = connectors.length === 0 && hasWorkspaceApiKeyAuth();
  const connectorResults = skipConnectorSync
    ? []
    : (await pushConnectors(connectors)).results;

  if (project.site?.outputDirectory) {
    const outputDir = resolve(project.root, project.site.outputDirectory);
    const { appUrl } = await deploySite(outputDir);
    return { appUrl, connectorResults, syncResults };
  }

  return { connectorResults, syncResults };
}
