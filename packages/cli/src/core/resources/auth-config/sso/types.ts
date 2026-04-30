import type { SSOSecretKey } from "./secret-keys.js";

export const KNOWN_SSO_PROVIDERS = {
  google: "google",
  microsoft: "microsoft",
  github: "github",
  okta: "okta",
  custom: "custom",
} as const;

export type KnownSSOProvider =
  (typeof KNOWN_SSO_PROVIDERS)[keyof typeof KNOWN_SSO_PROVIDERS];

export interface SSOProviderSchema {
  /** Secret keys required for this provider (beyond the base set) */
  requiredKeys: SSOSecretKey[];
  /** Default values for secrets (e.g., scope, discovery URL) */
  defaults: Partial<Record<SSOSecretKey, string>>;
  /** Function to derive default values from other options */
  deriveDefaults?: (secrets: Record<string, string>) => Record<string, string>;
}

export interface SSOSecretOptions {
  clientId: string;
  clientSecret: string;
  scope?: string;
  discoveryUrl?: string;
  tenantId?: string;
  oktaDomain?: string;
  authEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  ssoName?: string;
}
