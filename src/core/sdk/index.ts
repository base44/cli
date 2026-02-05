/**
 * SDK module exports.
 *
 * This is the public API of the Base44 Local Project SDK.
 */

export {
  AgentsNamespace,
  AuthNamespace,
  type CreateProjectOptions,
  type CreateProjectResult,
  EntitiesNamespace,
  FunctionsNamespace,
  ProjectNamespace,
  SiteNamespace,
} from "./namespaces/index.js";
export type { DeployAllOptions, DeployAllResult } from "./sdk.js";
export { Base44LocalProjectSDK } from "./sdk.js";
export type { AppClient, SDKConfig } from "./types.js";
