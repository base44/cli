import { isCancel, password, text } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";
import type { GitHubSSOCredentials } from "./types.js";

const GITHUB_AUTH_ENDPOINT = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_USERINFO_ENDPOINT = "https://api.github.com/user";
const GITHUB_SSO_SCOPE = "user:email";

export async function promptGitHubCredentials(): Promise<GitHubSSOCredentials> {
  const clientId = await text({
    message: "GitHub OAuth Client ID",
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
    message: "GitHub OAuth Client Secret",
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
    initialValue: GITHUB_SSO_SCOPE,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Scope is required";
      }
    },
  });

  if (isCancel(scope)) {
    throw new CLIExitError(0);
  }

  const authEndpoint = await text({
    message: "Authorization endpoint",
    initialValue: GITHUB_AUTH_ENDPOINT,
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
    initialValue: GITHUB_TOKEN_ENDPOINT,
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
    initialValue: GITHUB_USERINFO_ENDPOINT,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Userinfo endpoint is required";
      }
    },
  });

  if (isCancel(userinfoEndpoint)) {
    throw new CLIExitError(0);
  }

  return {
    ssoName: "github",
    ssoClientId: clientId,
    ssoClientSecret: clientSecret,
    ssoScope: scope,
    ssoAuthEndpoint: authEndpoint,
    ssoTokenEndpoint: tokenEndpoint,
    ssoUserinfoEndpoint: userinfoEndpoint,
  };
}
