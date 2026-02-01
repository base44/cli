/**
 * SDK type definitions.
 */

import type { KyInstance } from "ky";

/**
 * Configuration for initializing the SDK.
 */
export interface SDKConfig {
  /** Root directory of the project */
  projectRoot: string;
  /** Base44 app ID */
  appId: string;
}

/**
 * App-scoped HTTP client type.
 */
export type AppClient = KyInstance;
