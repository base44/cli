/**
 * Base44 Local Project SDK
 *
 * The main export is `Base44LocalProjectSDK` - a facade for working with Base44 projects.
 *
 * @example
 * ```typescript
 * import { Base44LocalProjectSDK } from "@/core";
 *
 * const sdk = await Base44LocalProjectSDK.fromCurrentDirectory();
 * const entities = await sdk.entities.readAll();
 * await sdk.entities.push(entities);
 * ```
 */

// ==================== PUBLIC SDK API ====================
export {
  AgentsNamespace,
  type AppClient,
  AuthNamespace,
  Base44LocalProjectSDK,
  type CreateProjectOptions,
  type CreateProjectResult,
  type DeployAllOptions,
  type DeployAllResult,
  EntitiesNamespace,
  FunctionsNamespace,
  ProjectNamespace,
  type SDKConfig,
  SiteNamespace,
} from "./sdk/index.js";

// ==================== BACKWARD COMPATIBILITY ====================
// These re-exports maintain backward compatibility with existing code.
// New code should use the SDK API above.

export * from "./auth/index.js";
export * from "./clients/index.js";
export * from "./config.js";
export * from "./consts.js";
export * from "./errors.js";
export * from "./project/index.js";
export * from "./resources/index.js";
export * from "./site/index.js";
export * from "./utils/index.js";
