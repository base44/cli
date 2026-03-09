import { isCancel, password, text } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";
import type { MicrosoftSSOCredentials } from "./types.js";

const DEFAULT_SSO_SCOPE = "openid email profile";
const MICROSOFT_DISCOVERY_URL_BASE = "https://login.microsoftonline.com";
const PLACEHOLDER_UUID = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";

function buildDiscoveryUrl(tenantId: string): string {
  return `${MICROSOFT_DISCOVERY_URL_BASE}/${tenantId}/v2.0/.well-known/openid-configuration`;
}

export async function promptMicrosoftCredentials(): Promise<MicrosoftSSOCredentials> {
  const tenantId = await text({
    message: "Microsoft Tenant ID",
    placeholder: PLACEHOLDER_UUID,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Tenant ID is required";
      }
    },
  });

  if (isCancel(tenantId)) {
    throw new CLIExitError(0);
  }

  const clientId = await text({
    message: "Microsoft Application (Client) ID",
    placeholder: PLACEHOLDER_UUID,
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
    message: "Microsoft Client Secret",
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
    initialValue: buildDiscoveryUrl(tenantId),
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
    ssoName: "microsoft",
    ssoClientId: clientId,
    ssoClientSecret: clientSecret,
    ssoDiscoveryUrl: discoveryUrl,
    ssoScope: scope,
    ssoTenantId: tenantId,
  };
}
