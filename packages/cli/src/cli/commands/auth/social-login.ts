import { dirname, join, resolve } from "node:path";
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
} from "@/core/resources/auth-config/index.js";
import { parseEnvFile } from "@/core/utils/index.js";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  google: "Google",
  microsoft: "Microsoft",
  facebook: "Facebook",
  apple: "Apple",
};

const VALID_PROVIDER_NAMES: ProviderName[] = Object.keys(
  SOCIAL_PROVIDERS,
) as ProviderName[];

/** CLI-specific OAuth configuration per provider (env vars, prompt messages). */
const PROVIDER_OAUTH_CLI: Partial<
  Record<ProviderName, { envVar: string; promptMessage: string }>
> = {
  google: {
    envVar: "google_oauth_client_secret",
    promptMessage: "Enter Google OAuth client secret",
  },
};

interface SocialLoginOptions {
  clientId?: string;
  clientSecret?: string;
  clientSecretStdin?: boolean;
  envFile?: string;
}

function hasSecretOptions(options: SocialLoginOptions): boolean {
  return Boolean(
    options.clientSecret || options.clientSecretStdin || options.envFile,
  );
}

function hasCustomOAuthOptions(options: SocialLoginOptions): boolean {
  return Boolean(options.clientId || hasSecretOptions(options));
}

async function socialLoginAction(
  { log, isNonInteractive, runTask }: CLIContext,
  provider: ProviderName,
  action: "enable" | "disable",
  options: SocialLoginOptions,
): Promise<RunCommandResult> {
  const shouldEnable = action === "enable";
  const providerInfo = SOCIAL_PROVIDERS[provider];
  const label = PROVIDER_LABELS[provider];
  const hasOAuthOptions = hasCustomOAuthOptions(options);

  // Validate custom OAuth options against provider support
  if (hasOAuthOptions && !providerInfo.customOAuth) {
    throw new InvalidInputError(
      `Custom OAuth options are only supported for providers with custom OAuth (e.g., google). Use: base44 auth social-login ${provider} ${action}`,
    );
  }

  if (hasOAuthOptions && !shouldEnable) {
    throw new InvalidInputError(
      `Custom OAuth options cannot be used with disable. To disable ${label} login: base44 auth social-login ${provider} disable`,
    );
  }

  // Validate that --client-id is present when secret options are provided
  if (hasSecretOptions(options) && !options.clientId) {
    throw new InvalidInputError(
      `--client-id is required when providing a client secret. Use: base44 auth social-login ${provider} enable --client-id <id> --client-secret <secret>`,
    );
  }

  // Resolve custom OAuth secret if applicable
  const oauth = providerInfo.customOAuth;
  const oauthCli = PROVIDER_OAUTH_CLI[provider];
  const useCustomOAuth = shouldEnable && hasOAuthOptions && oauth != null;
  let clientSecret: string | undefined;

  if (useCustomOAuth && oauth && oauthCli && hasSecretOptions(options)) {
    if (options.envFile) {
      const secrets = await parseEnvFile(resolve(options.envFile));
      const value = secrets[oauthCli.envVar];
      if (!value) {
        throw new InvalidInputError(
          `Key "${oauthCli.envVar}" not found in ${options.envFile}.`,
        );
      }
      clientSecret = value;
    } else {
      clientSecret = await resolveSecret({
        flagValue: options.clientSecret,
        fromStdin: options.clientSecretStdin,
        envVar: oauthCli.envVar,
        promptMessage: oauthCli.promptMessage,
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
            message: `Provide via env:    ${oauthCli.envVar}=<secret> base44 auth social-login ${provider} enable --client-id <id>`,
          },
        ],
      });
    }
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
      `Disabling ${label} login will leave no login methods enabled. Users will be locked out.`,
    );
  }

  const newStatus = shouldEnable ? "enabled" : "disabled";
  const oauthNote = useCustomOAuth ? " with custom OAuth" : "";

  let outroMessage = `${label} login ${newStatus}${oauthNote} in local config. Run \`base44 auth push\` or \`base44 deploy\` to apply.`;

  // Hint about pushing secrets separately when client-id was set without a secret
  if (useCustomOAuth && !clientSecret) {
    outroMessage += `\nRemember to push the client secret separately: base44 secrets set --env-file <path>`;
  }

  return { outroMessage };
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
    .option(
      "--env-file <path>",
      "read client secret from a .env file (Google only)",
    )
    .action(socialLoginAction);
}
