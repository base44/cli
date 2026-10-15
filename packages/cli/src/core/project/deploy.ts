import { resolve } from "node:path";
import { hasWorkspaceApiKeyAuth } from "@/core/auth/config.js";
import { ApiError, ResourceDeploymentError } from "@/core/errors.js";
import { setAppVisibility } from "@/core/project/api.js";
import type { Visibility } from "@/core/project/schema.js";
import type { ProjectData } from "@/core/project/types.js";
import {
  deployActorsSequentially,
  describeActorResult,
  type SingleActorDeployResult,
} from "@/core/resources/actor/index.js";
import { agentResource } from "@/core/resources/agent/index.js";
import { agentSkillResource } from "@/core/resources/agent-skill/index.js";
import { authConfigResource } from "@/core/resources/auth-config/index.js";
import {
  type ConnectorSyncResult,
  pushConnectors,
} from "@/core/resources/connector/index.js";
import { entityResource } from "@/core/resources/entity/index.js";
import {
  deployFunctionsSequentially,
  type SingleFunctionDeployResult,
} from "@/core/resources/function/deploy.js";
import {
  deploySite,
  deployToDeployments,
  detectFullStackArtifact,
  publishDeployment,
  resolveGitHash,
} from "@/core/site/index.js";

/**
 * Checks if there are any resources to deploy in the project.
 *
 * @param projectData - The project configuration and resources
 * @returns true if there are entities, functions, agents, connectors, or a configured site to deploy
 */
export async function hasResourcesToDeploy(
  projectData: ProjectData,
): Promise<boolean> {
  const {
    project,
    entities,
    functions,
    actors,
    agents,
    agentSkills,
    connectors,
    authConfig,
  } = projectData;
  // A full-stack build brings its own assets directory, so it is a site to
  // deploy even with no site.outputDirectory configured.
  const hasSite =
    Boolean(project.site?.outputDirectory) ||
    Boolean(await detectFullStackArtifact(project.root));
  const hasEntities = entities.length > 0;
  const hasFunctions = functions.length > 0;
  const hasActors = actors.length > 0;
  const hasAgents = agents.length > 0;
  const hasAgentSkills = agentSkills.length > 0;
  const hasConnectors = connectors.length > 0;
  const hasAuthConfig = authConfig.length > 0;
  const hasVisibility = Boolean(project.visibility);

  return (
    hasEntities ||
    hasFunctions ||
    hasActors ||
    hasAgents ||
    hasAgentSkills ||
    hasConnectors ||
    hasAuthConfig ||
    hasVisibility ||
    hasSite
  );
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
}

interface DeployAllOptions {
  /** The commit the built output came from; resolved from the checkout if omitted. */
  gitHash?: string;
  /** Serve the deployed build in production. Defaults to true. */
  publish?: boolean;
  onSiteProgress?: (message: string) => void;
  onActorStart?: (name: string) => void;
  onActorResult?: (result: SingleActorDeployResult) => void;
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
    actors,
    agents,
    agentSkills,
    connectors,
    authConfig,
  } = projectData;

  await setAppVisibility(project.visibility);
  if (project.visibility) {
    options?.onVisibilitySet?.(project.visibility);
  }
  await entityResource.push(entities);
  const functionResults = await deployFunctionsSequentially(functions, {
    onStart: options?.onFunctionStart,
    onResult: options?.onFunctionResult,
  });
  const completedStages = [
    ...(project.visibility ? [`Visibility set to ${project.visibility}`] : []),
    ...(entities.length ? [`Entities synced: ${entities.length}`] : []),
  ];
  const functionDetails = functionResults.map(
    (result) =>
      `Function ${result.name}: ${result.status}${result.error ? ` — ${result.error}` : ""}`,
  );
  if (functionResults.some((result) => result.status === "error")) {
    throw new ResourceDeploymentError(
      "Function deployment failed; remaining deploy stages were not run",
      {
        details: [...completedStages, ...functionDetails],
      },
    );
  }
  const actorResults = await deployActorsSequentially(actors, {
    onStart: options?.onActorStart,
    onResult: options?.onActorResult,
  });
  if (actorResults.some((result) => result.status === "error")) {
    throw new ResourceDeploymentError(
      "Actor deployment failed; remaining deploy stages were not run",
      {
        details: [
          ...completedStages,
          ...functionDetails,
          ...actorResults.map(describeActorResult),
        ],
      },
    );
  }
  await agentSkillResource.push(agentSkills);
  await agentResource.push(agents);
  await authConfigResource.push(authConfig);
  // pushConnectors also reconciles: with an empty list it removes remote
  // connectors that are no longer configured locally. Only skip that when a
  // workspace API key is in use, since those principals get a 403 on the
  // connectors-list endpoint. OAuth users must still reconcile removals.
  const skipConnectorSync = connectors.length === 0 && hasWorkspaceApiKeyAuth();
  const connectorResults = skipConnectorSync
    ? []
    : (await pushConnectors(connectors)).results;

  const appUrl = await deployProjectSite(project, options);
  return appUrl ? { appUrl, connectorResults } : { connectorResults };
}

/**
 * Ship the built output, then serve it.
 *
 * Through the deployments API, so a full-stack build's worker ships like any
 * other build and what went live is addressed by the commit that produced it.
 * A project with no commit behind it has no such address, so it keeps the
 * archive upload — the one caller left on it, along with the scaffold deploy in
 * `base44 create`, which runs before a project has any history at all.
 */
async function deployProjectSite(
  project: ProjectData["project"],
  options?: DeployAllOptions,
): Promise<string | undefined> {
  const outputDirectory = project.site?.outputDirectory;
  const outputDir = outputDirectory
    ? resolve(project.root, outputDirectory)
    : null;

  if (!outputDir) {
    // A worker build has no archive form, so a missing commit is fatal here and
    // the resolver's own guidance is the error.
    if (!(await detectFullStackArtifact(project.root))) {
      return undefined;
    }
    const gitHash = await resolveGitHash(project.root, options?.gitHash);
    return shipCommit(project.root, null, gitHash, options);
  }

  const gitHash = await resolveGitHash(project.root, options?.gitHash).catch(
    () => undefined,
  );
  if (!gitHash) {
    options?.onSiteProgress?.(
      "No commit found for this build, so it was deployed without one. Commit your work to address deployments by it.",
    );
    const { appUrl } = await deploySite(outputDir);
    return appUrl;
  }
  return shipCommit(project.root, outputDir, gitHash, options);
}

async function shipCommit(
  projectRoot: string,
  outputDir: string | null,
  gitHash: string,
  options?: DeployAllOptions,
): Promise<string | undefined> {
  await deployToDeployments({
    projectRoot,
    outputDir,
    gitHash,
    progress: {
      onWarning: (message) => options?.onSiteProgress?.(message),
      onAssets: ({ totalAssets, newAssets }) =>
        options?.onSiteProgress?.(
          `Found ${totalAssets} static assets (${newAssets} new)`,
        ),
    },
  });

  if (options?.publish === false) {
    return undefined;
  }
  try {
    const { appUrl } = await publishDeployment(gitHash);
    return appUrl;
  } catch (error) {
    // An app Base44 builds is published from the builder, where checkpoints and
    // branch rules live. Its resources and its build did deploy, so reporting
    // that as a failed deploy would be wrong.
    if (!publishesFromBuilder(error)) {
      throw error;
    }
    options?.onSiteProgress?.(
      "Site deployed. This app is published from the Base44 builder, so production was left where it was.",
    );
    return undefined;
  }
}

/** The server's stable code for "this app does not publish through the CLI". */
function publishesFromBuilder(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  const body = error.responseBody as
    | { extra_data?: { code?: unknown } }
    | undefined;
  return body?.extra_data?.code === "app_publishes_from_builder";
}
