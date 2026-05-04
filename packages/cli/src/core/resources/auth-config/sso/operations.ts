import { InvalidInputError } from "@/core/errors.js";
import { deleteSecret, setSecrets } from "@/core/resources/secret/index.js";
import {
  DEFAULT_AUTH_CONFIG,
  readAuthConfig,
  writeAuthConfig,
} from "../config.js";
import type { AuthConfig } from "../schema.js";
import { SSO_PROVIDER_SCHEMAS } from "./providers/index.js";
import { ALL_SSO_SECRET_KEYS, SSOSecretKey } from "./secret-keys.js";
import type { KnownSSOProvider, SSOSecretOptions } from "./types.js";
import { KNOWN_SSO_PROVIDERS } from "./types.js";

/** Maps SSOSecretOptions fields to API secret keys. */
const OPTION_TO_SECRET_KEY: Record<string, SSOSecretKey> = {
  scope: SSOSecretKey.Scope,
  discoveryUrl: SSOSecretKey.DiscoveryUrl,
  tenantId: SSOSecretKey.TenantId,
  oktaDomain: SSOSecretKey.OktaDomain,
  authEndpoint: SSOSecretKey.AuthEndpoint,
  tokenEndpoint: SSOSecretKey.TokenEndpoint,
  userinfoEndpoint: SSOSecretKey.UserinfoEndpoint,
  jwksUri: SSOSecretKey.JwksUri,
};

/**
 * Updates the local auth config to enable or disable SSO.
 * Enabling SSO disables all social login providers (mutually exclusive).
 */
export async function updateSSOConfig(
  authDir: string,
  provider: KnownSSOProvider | null,
  enable: boolean,
): Promise<AuthConfig> {
  const current = (await readAuthConfig(authDir)) ?? DEFAULT_AUTH_CONFIG;

  const merged: AuthConfig = {
    ...current,
    enableSSOLogin: enable,
    ssoProviderName: enable && provider ? provider : null,
    // SSO and social login are mutually exclusive
    ...(enable && {
      enableGoogleLogin: false,
      enableMicrosoftLogin: false,
      enableFacebookLogin: false,
      enableAppleLogin: false,
    }),
  };

  await writeAuthConfig(authDir, merged);
  return merged;
}

/**
 * Thrown by `buildSSOSecrets` when required secret fields are missing.
 * Exposes structured `missingKeys` so the CLI can map them to flag names
 * without string-parsing the message.
 */
export class MissingSSOFieldsError extends InvalidInputError {
  readonly missingKeys: SSOSecretKey[];
  readonly provider: KnownSSOProvider;

  constructor(provider: KnownSSOProvider, missingKeys: SSOSecretKey[]) {
    super(`Missing required fields for ${provider}: ${missingKeys.join(", ")}`);
    this.provider = provider;
    this.missingKeys = missingKeys;
  }
}

/**
 * Builds the secrets payload for an SSO provider.
 * Validates required fields per provider, applies defaults, and returns
 * the API-ready secret key/value map.
 *
 * Throws `MissingSSOFieldsError` with the structured list of missing keys
 * so the CLI layer can format them for the user.
 */
export function buildSSOSecrets(
  provider: KnownSSOProvider,
  options: SSOSecretOptions,
): Record<string, string> {
  const schema = SSO_PROVIDER_SCHEMAS[provider];

  const secrets: Record<string, string> = {};
  secrets[SSOSecretKey.Name] = options.ssoName ?? provider;
  secrets[SSOSecretKey.ClientId] = options.clientId;
  secrets[SSOSecretKey.ClientSecret] = options.clientSecret;

  // Map option fields to secret keys
  for (const [optionKey, secretKey] of Object.entries(OPTION_TO_SECRET_KEY)) {
    const value = options[optionKey as keyof SSOSecretOptions];
    if (typeof value === "string" && value.length > 0) {
      secrets[secretKey] = value;
    }
  }

  // Apply derived defaults (e.g., discovery URL from tenant ID)
  if (schema.deriveDefaults) {
    const derived = schema.deriveDefaults(secrets);
    for (const [key, val] of Object.entries(derived)) {
      if (!secrets[key]) {
        secrets[key] = val;
      }
    }
  }

  // Apply static defaults
  for (const [key, val] of Object.entries(schema.defaults)) {
    if (!secrets[key]) {
      secrets[key] = val;
    }
  }

  // Validate required keys — collect missing as typed enum values
  const missing: SSOSecretKey[] = [];
  for (const key of schema.requiredKeys) {
    if (!secrets[key]) {
      missing.push(key);
    }
  }

  if (provider === KNOWN_SSO_PROVIDERS.custom && !options.ssoName) {
    missing.push(SSOSecretKey.Name);
  }

  if (missing.length > 0) {
    throw new MissingSSOFieldsError(provider, missing);
  }

  // Remove empty values
  return Object.fromEntries(
    Object.entries(secrets).filter(([, v]) => v.length > 0),
  );
}

/**
 * Pushes SSO secrets to the backend via the secrets API.
 */
export async function pushSSOSecrets(
  secrets: Record<string, string>,
): Promise<void> {
  await setSecrets(secrets);
}

/**
 * Deletes all known SSO secret keys (best-effort).
 */
export async function deleteSSOSecrets(): Promise<void> {
  await Promise.allSettled(ALL_SSO_SECRET_KEYS.map((key) => deleteSecret(key)));
}
