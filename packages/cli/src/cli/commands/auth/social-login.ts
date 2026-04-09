import { dirname, join } from "node:path";
import { Argument, type Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, resolveSecret } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import type { ProviderName } from "@/core/resources/auth-config/index.js";
import {
  hasAnyLoginMethod,
  pushCustomOAuthSecret,
  SOCIAL_PROVIDERS,
  updateSocialLoginConfig,
  VALID_PROVIDER_NAMES,
} from "@/core/resources/auth-config/index.js";

interface SocialLoginOptions {
  clientId?: string;
  clientSecret?: string;
  clientSecretStdin?: boolean;
}

function hasCustomOAuthOptions(options: SocialLoginOptions): boolean {
  return Boolean(
    options.clientId || options.clientSecret || options.clientSecretStdin,
  );
}

async function socialLoginAction(
  { log, isNonInteractive, runTask }: CLIContext,
  provider: ProviderName,
  action: "enable" | "disable",
  options: SocialLoginOptions,
): Promise<RunCommandResult> {
  const shouldEnable = action === "enable";
  const providerInfo = SOCIAL_PROVIDERS[provider];
  const hasOAuthOptions = hasCustomOAuthOptions(options);

  // Validate custom OAuth options against provider support
  if (hasOAuthOptions && !providerInfo.customOAuth) {
    throw new InvalidInputError(
      `Custom OAuth options are only supported for providers with custom OAuth (e.g., google). Use: base44 auth social-login ${provider} ${action}`,
    );
  }

  if (hasOAuthOptions && !shouldEnable) {
    throw new InvalidInputError(
      `Custom OAuth options cannot be used with disable. To disable ${providerInfo.label} login: base44 auth social-login ${provider} disable`,
    );
  }

  // Resolve custom OAuth secret if applicable
  const oauth = providerInfo.customOAuth;
  const useCustomOAuth = shouldEnable && hasOAuthOptions && oauth != null;
  let clientSecret: string | undefined;

  if (useCustomOAuth && oauth) {
    clientSecret = await resolveSecret({
      flagValue: options.clientSecret,
      fromStdin: options.clientSecretStdin,
      envVar: oauth.envVar,
      promptMessage: oauth.promptMessage,
      isNonInteractive,
      name: "client secret",
      hints: [
        {
          message: `Provide via flag:   base44 auth social-login ${provider} enable --client-id <id> --client-secret <secret>`,
          command: `base44 auth social-login ${provider} enable --client-id <id> --client-secret <secret>`,
        },
        {
          message: `Provide via stdin:  echo <secret> | base44 auth social-login ${provider} enable --client-id <id> --client-secret-stdin`,
        },
        {
          message: `Provide via env:    ${oauth.envVar}=<secret> base44 auth social-login ${provider} enable --client-id <id>`,
        },
      ],
    });
  }

  const { project } = await readProjectConfig();
  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  // Update local auth config
  const { config: updated } = await runTask(
    "Updating local auth config",
    async () =>
      updateSocialLoginConfig(
        authDir,
        provider,
        shouldEnable,
        useCustomOAuth && options.clientId
          ? { clientId: options.clientId }
          : undefined,
      ),
  );

  // Push secret to API if custom OAuth
  if (clientSecret) {
    await runTask("Saving client secret", async () =>
      pushCustomOAuthSecret(provider, clientSecret),
    );
  }

  if (!shouldEnable && !hasAnyLoginMethod(updated)) {
    log.warn(
      `Disabling ${providerInfo.label} login will leave no login methods enabled. Users will be locked out.`,
    );
  }

  const newStatus = shouldEnable ? "enabled" : "disabled";
  const oauthNote = useCustomOAuth ? " with custom OAuth" : "";
  return {
    outroMessage: `${providerInfo.label} login ${newStatus}${oauthNote} in local config. Run \`base44 auth push\` or \`base44 deploy\` to apply.`,
  };
}

export function getSocialLoginCommand(): Command {
  return new Base44Command("social-login")
    .description(
      "Enable or disable social login providers (google, microsoft, facebook, apple)",
    )
    .addArgument(
      new Argument("<provider>", "social login provider").choices(
        VALID_PROVIDER_NAMES,
      ),
    )
    .addArgument(
      new Argument("<action>", "enable or disable the provider").choices([
        "enable",
        "disable",
      ]),
    )
    .option("--client-id <id>", "custom OAuth client ID (Google only)")
    .option(
      "--client-secret <secret>",
      "custom OAuth client secret (Google only)",
    )
    .option(
      "--client-secret-stdin",
      "read client secret from stdin (Google only)",
    )
    .action(socialLoginAction);
}
