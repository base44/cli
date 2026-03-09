import { isCancel, password, text } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";
import type { CustomSSOCredentials } from "./types.js";

const DEFAULT_SSO_SCOPE = "openid email profile";
const PLACEHOLDER_DISCOVERY_URL =
  "https://idp.example.com/.well-known/openid-configuration";
const PLACEHOLDER_AUTH_ENDPOINT = "https://idp.example.com/authorize";
const PLACEHOLDER_TOKEN_ENDPOINT = "https://idp.example.com/token";
const PLACEHOLDER_USERINFO_ENDPOINT = "https://idp.example.com/userinfo";
const PLACEHOLDER_JWKS_URI = "https://idp.example.com/.well-known/jwks.json";

export async function promptCustomCredentials(): Promise<CustomSSOCredentials> {
  const ssoName = await text({
    message: "SSO provider name",
    placeholder: "my-idp",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Provider name is required";
      }
    },
  });

  if (isCancel(ssoName)) {
    throw new CLIExitError(0);
  }

  const clientId = await text({
    message: "Client ID",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Client ID is required";
      }
    },
  });

  if (isCancel(clientId)) {
    throw new CLIExitError(0);
  }

  const clientSecret = await password({
    message: "Client Secret",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Client Secret is required";
      }
    },
  });

  if (isCancel(clientSecret)) {
    throw new CLIExitError(0);
  }

  const scope = await text({
    message: "SSO scope",
    initialValue: DEFAULT_SSO_SCOPE,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Scope is required";
      }
    },
  });

  if (isCancel(scope)) {
    throw new CLIExitError(0);
  }

  const discoveryUrl = await text({
    message: "Discovery URL (optional)",
    placeholder: PLACEHOLDER_DISCOVERY_URL,
  });

  if (isCancel(discoveryUrl)) {
    throw new CLIExitError(0);
  }

  const authEndpoint = await text({
    message: "Authorization endpoint",
    placeholder: PLACEHOLDER_AUTH_ENDPOINT,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Authorization endpoint is required";
      }
    },
  });

  if (isCancel(authEndpoint)) {
    throw new CLIExitError(0);
  }

  const tokenEndpoint = await text({
    message: "Token endpoint",
    placeholder: PLACEHOLDER_TOKEN_ENDPOINT,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Token endpoint is required";
      }
    },
  });

  if (isCancel(tokenEndpoint)) {
    throw new CLIExitError(0);
  }

  const userinfoEndpoint = await text({
    message: "Userinfo endpoint",
    placeholder: PLACEHOLDER_USERINFO_ENDPOINT,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Userinfo endpoint is required";
      }
    },
  });

  if (isCancel(userinfoEndpoint)) {
    throw new CLIExitError(0);
  }

  const jwksUri = await text({
    message: "JWKS URI",
    placeholder: PLACEHOLDER_JWKS_URI,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "JWKS URI is required";
      }
    },
  });

  if (isCancel(jwksUri)) {
    throw new CLIExitError(0);
  }

  return {
    ssoName,
    ssoClientId: clientId,
    ssoClientSecret: clientSecret,
    ssoScope: scope,
    ssoDiscoveryUrl: discoveryUrl || undefined,
    ssoAuthEndpoint: authEndpoint,
    ssoTokenEndpoint: tokenEndpoint,
    ssoUserinfoEndpoint: userinfoEndpoint,
    ssoJwksUri: jwksUri,
  };
}
