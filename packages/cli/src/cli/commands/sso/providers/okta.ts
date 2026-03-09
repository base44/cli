import { isCancel, password, text } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";
import type { OktaSSOCredentials } from "./types.js";

const DEFAULT_SSO_SCOPE = "openid email profile";
const PLACEHOLDER_OKTA_DOMAIN = "your-org.okta.com";

function buildDiscoveryUrl(domain: string): string {
  return `https://${domain}/.well-known/openid-configuration`;
}

export async function promptOktaCredentials(): Promise<OktaSSOCredentials> {
  const oktaDomain = await text({
    message: "Okta domain",
    placeholder: PLACEHOLDER_OKTA_DOMAIN,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Okta domain is required";
      }
    },
  });

  if (isCancel(oktaDomain)) {
    throw new CLIExitError(0);
  }

  const clientId = await text({
    message: "Okta Client ID",
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
    message: "Okta Client Secret",
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
    initialValue: buildDiscoveryUrl(oktaDomain),
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
    ssoName: "okta",
    ssoClientId: clientId,
    ssoClientSecret: clientSecret,
    ssoDiscoveryUrl: discoveryUrl,
    ssoScope: scope,
    ssoOktaDomain: oktaDomain,
  };
}
