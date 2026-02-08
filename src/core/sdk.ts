// SDK Facade - single API surface between CLI and core internals.
// CLI commands receive the SDK via dependency injection, never importing core modules directly.
//
// Use `createProjectSDK()` to create an instance. Later, this factory can accept
// configuration (e.g., app config, auth tokens) to enable true instance isolation.

// --- Auth ---
import {
  generateDeviceCode,
  getTokenFromDeviceCode,
  getUserInfo,
} from "@/core/auth/api.js";
import {
  deleteAuth,
  isLoggedIn,
  readAuth,
  requireAuth,
  writeAuth,
} from "@/core/auth/config.js";
// --- Project ---
import { createProject, listProjects } from "@/core/project/api.js";
import {
  appConfigExists,
  getAppConfig,
  initAppConfig,
  setAppConfig,
  writeAppConfig,
} from "@/core/project/app-config.js";
import { findProjectRoot, readProjectConfig } from "@/core/project/config.js";
import { createProjectFiles } from "@/core/project/create.js";
import { deployAll, hasResourcesToDeploy } from "@/core/project/deploy.js";
import { listTemplates } from "@/core/project/template.js";
// --- Resources ---
import { fetchAgents, pushAgents } from "@/core/resources/agent/api.js";
import { writeAgents } from "@/core/resources/agent/config.js";
import { pushEntities } from "@/core/resources/entity/deploy.js";
import { pushFunctions } from "@/core/resources/function/deploy.js";
// --- Site ---
import { getSiteUrl } from "@/core/site/api.js";
import { deploySite } from "@/core/site/deploy.js";
// --- Types ---
import { generateTypesFile } from "@/core/types/generator.js";
import { updateProjectConfig } from "@/core/types/update-project.js";
// --- Utils ---
import { isDirEmpty } from "@/core/utils/fs.js";

// --- Re-export types that CLI commands need ---
export type {
  AuthData,
  DeviceCodeResponse,
  TokenResponse,
  UserInfoResponse,
} from "@/core/auth/schema.js";
export type { CachedAppConfig } from "@/core/project/app-config.js";
export type {
  CreateProjectOptions,
  CreateProjectResult,
} from "@/core/project/create.js";
export type { DeployAllResult } from "@/core/project/deploy.js";
export type {
  Project,
  ProjectConfig,
  Template,
} from "@/core/project/schema.js";
export type { ProjectData, ProjectRoot } from "@/core/project/types.js";
export type {
  AgentConfig,
  AgentConfigApiResponse,
  ListAgentsResponse,
  SyncAgentsResponse,
} from "@/core/resources/agent/schema.js";
export type {
  Entity,
  SyncEntitiesResponse,
} from "@/core/resources/entity/schema.js";
export type {
  BackendFunction,
  DeployFunctionsResponse,
} from "@/core/resources/function/schema.js";
export type { DeployResponse as SiteDeployResponse } from "@/core/site/schema.js";
export type { GenerateTypesInput } from "@/core/types/generator.js";

export type ProjectSDK = ReturnType<typeof createProjectSDK>;

export function createProjectSDK() {
  return {
    auth: {
      read: readAuth,
      write: writeAuth,
      delete: deleteAuth,
      isLoggedIn,
      requireAuth,
      generateDeviceCode,
      getTokenFromDeviceCode,
      getUserInfo,
    },
    project: {
      readConfig: readProjectConfig,
      createFiles: createProjectFiles,
      create: createProject,
      list: listProjects,
      listTemplates,
      findRoot: findProjectRoot,
      initAppConfig,
      getAppConfig,
      setAppConfig,
      appConfigExists,
      writeAppConfig,
      deployAll,
      hasResourcesToDeploy,
      isDirEmpty,
    },
    entities: {
      push: pushEntities,
    },
    functions: {
      push: pushFunctions,
    },
    agents: {
      push: pushAgents,
      fetch: fetchAgents,
      writeLocal: writeAgents,
    },
    site: {
      deploy: deploySite,
      getUrl: getSiteUrl,
    },
    types: {
      generate: generateTypesFile,
      updateProjectConfig,
    },
  };
}
