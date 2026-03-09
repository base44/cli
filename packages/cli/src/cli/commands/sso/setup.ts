import { confirm, isCancel, log, select } from "@clack/prompts";
import { Command } from "commander";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import {
  type AuthConfig,
  CREDENTIALS_KEY_MAP,
  getAuthConfig,
  type KnownSSOProvider,
  submitSSOConfig,
} from "@/core/auth-config/index.js";
import {
  promptCustomCredentials,
  promptGitHubCredentials,
  promptGoogleCredentials,
  promptMicrosoftCredentials,
  promptOktaCredentials,
  type SSOCredentials,
} from "./providers/index.js";

async function promptSSOProvider(): Promise<KnownSSOProvider> {
  const provider = await select({
    message: "Select SSO provider",
    options: [
      {
        value: "google" as const,
        label: "Google",
        hint: "Google Workspace / Google Identity",
      },
      {
        value: "microsoft" as const,
        label: "Microsoft",
        hint: "Microsoft Entra ID / Azure AD",
      },
      {
        value: "github" as const,
        label: "GitHub",
        hint: "GitHub OAuth",
      },
      {
        value: "okta" as const,
        label: "Okta",
        hint: "Okta OIDC",
      },
      {
        value: "custom" as const,
        label: "Custom",
        hint: "Manual OIDC / OAuth configuration",
      },
    ],
  });

  if (isCancel(provider)) {
    throw new CLIExitError(0);
  }

  return provider;
}

const credentialPrompters: Record<
  KnownSSOProvider,
  () => Promise<SSOCredentials>
> = {
  google: promptGoogleCredentials,
  microsoft: promptMicrosoftCredentials,
  github: promptGitHubCredentials,
  okta: promptOktaCredentials,
  custom: promptCustomCredentials,
};

function buildSecretsPayload(
  credentials: SSOCredentials,
): Record<string, string> {
  const secrets: Record<string, string> = {};

  for (const [camelKey, snakeKey] of Object.entries(CREDENTIALS_KEY_MAP)) {
    const value = (credentials as unknown as Record<string, unknown>)[camelKey];
    if (typeof value === "string" && value.length > 0) {
      secrets[snakeKey] = value;
    }
  }

  return secrets;
}

function printAuthConfigSummary(config: AuthConfig): void {
  log.info(theme.styles.bold("Updated authentication config:"));
  log.info(
    `  SSO Login:      ${config.enableSSOLogin ? "enabled" : "disabled"}`,
  );
  log.info(`  SSO Provider:   ${config.ssoProviderName ?? "none"}`);
}

async function setupSSOAction(): Promise<RunCommandResult> {
  const current = await runTask(
    "Fetching current auth config",
    async () => await getAuthConfig(),
  );

  if (current.enableSSOLogin) {
    log.warn(
      `SSO is already enabled with provider: ${theme.styles.bold(current.ssoProviderName ?? "unknown")}`,
    );

    const shouldContinue = await confirm({
      message: "Do you want to replace the existing SSO configuration?",
    });

    if (isCancel(shouldContinue) || !shouldContinue) {
      throw new CLIExitError(0);
    }
  }

  const provider = await promptSSOProvider();
  const credentials = await credentialPrompters[provider]();
  const secrets = buildSecretsPayload(credentials);

  const updated = await runTask(
    "Configuring SSO",
    async () =>
      await submitSSOConfig(secrets, {
        ssoProviderName: credentials.ssoName,
        enableSSOLogin: true,
        useWorkspaceSSO: false,
      }),
  );

  printAuthConfigSummary(updated);

  return {
    outroMessage: `SSO configured with ${provider}`,
  };
}

export function getSSOSetupCommand(context: CLIContext): Command {
  return new Command("setup")
    .description("Configure SSO identity provider for the app")
    .action(async () => {
      await runCommand(setupSSOAction, { requireAuth: true }, context);
    });
}
