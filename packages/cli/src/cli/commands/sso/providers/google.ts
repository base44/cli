import { isCancel, password, text } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";
import type { GoogleSSOCredentials } from "./types.js";

const DEFAULT_DISCOVERY_URL =
  "https://accounts.google.com/.well-known/openid-configuration";
const DEFAULT_SSO_SCOPE = "openid email profile";
const PLACEHOLDER_CLIENT_ID = "xxxx.apps.googleusercontent.com";

export async function promptGoogleCredentials(): Promise<GoogleSSOCredentials> {
  const clientId = await text({
    message: "Google OAuth Client ID",
    placeholder: PLACEHOLDER_CLIENT_ID,
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
    message: "Google OAuth Client Secret",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Client Secret is required";
      }
    },
  });

  if (isCancel(clientSecret)) {
    throw new CLIExitError(0);
  }

  const discoveryUrl = await text({
    message: "Discovery URL",
    initialValue: DEFAULT_DISCOVERY_URL,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Discovery URL is required";
      }
    },
  });

  if (isCancel(discoveryUrl)) {
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

  return {
    ssoName: "google",
    ssoClientId: clientId,
    ssoClientSecret: clientSecret,
    ssoDiscoveryUrl: discoveryUrl,
    ssoScope: scope,
  };
}
