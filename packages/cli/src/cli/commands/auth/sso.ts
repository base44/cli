import { dirname, join, resolve } from "node:path";
import { Argument, type Command, Option } from "commander";
import { z } from "zod";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, resolveSecret } from "@/cli/utils/index.js";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  buildSSOSecrets,
  deleteSSOSecrets,
  hasAnyLoginMethod,
  KNOWN_SSO_PROVIDERS,
  type KnownSSOProvider,
  MissingSSOFieldsError,
  pushSSOSecrets,
  SSOSecretKey,
  type SSOSecretOptions,
  updateSSOConfig,
} from "@/core/resources/auth-config/index.js";
import { readJsonFile } from "@/core/utils/fs.js";
import { parseEnvFile } from "@/core/utils/index.js";

// -- File input schema (CLI concern: user-facing file format) ----------------

const SSOConfigFileSchema = z.object({
  provider: z.enum(
    Object.values(KNOWN_SSO_PROVIDERS) as [
      KnownSSOProvider,
      ...KnownSSOProvider[],
    ],
  ),
  clientId: z.string(),
  clientSecret: z.string(),
  scope: z.string().optional(),
  discoveryUrl: z.string().optional(),
  tenantId: z.string().optional(),
  oktaDomain: z.string().optional(),
  authEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userinfoEndpoint: z.string().optional(),
  jwksUri: z.string().optional(),
  ssoName: z.string().optional(),
});

type SSOConfigFile = z.infer<typeof SSOConfigFileSchema>;

async function loadSSOConfigFile(filePath: string): Promise<SSOConfigFile> {
  const resolved = resolve(filePath);
  const raw = await readJsonFile(resolved);
  const result = SSOConfigFileSchema.safeParse(raw);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid SSO config file",
      result.error,
      filePath,
    );
  }

  return result.data;
}

interface SSOOptions {
  provider?: string;
  clientId?: string;
  clientSecret?: string;
  clientSecretStdin?: boolean;
  envFile?: string;
  file?: string;
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

function mergeFileWithFlags(
  fileConfig: SSOConfigFile,
  options: SSOOptions,
): SSOOptions {
  return {
    provider: options.provider ?? fileConfig.provider,
    clientId: options.clientId ?? fileConfig.clientId,
    clientSecret: options.clientSecret ?? fileConfig.clientSecret,
    clientSecretStdin: options.clientSecretStdin,
    envFile: options.envFile,
    scope: options.scope ?? fileConfig.scope,
    discoveryUrl: options.discoveryUrl ?? fileConfig.discoveryUrl,
    tenantId: options.tenantId ?? fileConfig.tenantId,
    oktaDomain: options.oktaDomain ?? fileConfig.oktaDomain,
    authEndpoint: options.authEndpoint ?? fileConfig.authEndpoint,
    tokenEndpoint: options.tokenEndpoint ?? fileConfig.tokenEndpoint,
    userinfoEndpoint: options.userinfoEndpoint ?? fileConfig.userinfoEndpoint,
    jwksUri: options.jwksUri ?? fileConfig.jwksUri,
    ssoName: options.ssoName ?? fileConfig.ssoName,
  };
}

const providerNames = Object.keys(KNOWN_SSO_PROVIDERS);

/**
 * Maps each API secret key to its CLI flag name.
 * Note: `sso_name` intentionally maps to `--sso-name` (not `--name`) to avoid
 * collisions with potential future generic flags.
 */
const SECRET_KEY_TO_FLAG: Record<SSOSecretKey, string> = {
  [SSOSecretKey.Name]: "--sso-name",
  [SSOSecretKey.ClientId]: "--client-id",
  [SSOSecretKey.ClientSecret]: "--client-secret",
  [SSOSecretKey.Scope]: "--scope",
  [SSOSecretKey.DiscoveryUrl]: "--discovery-url",
  [SSOSecretKey.TenantId]: "--tenant-id",
  [SSOSecretKey.AuthEndpoint]: "--auth-endpoint",
  [SSOSecretKey.TokenEndpoint]: "--token-endpoint",
  [SSOSecretKey.UserinfoEndpoint]: "--userinfo-endpoint",
  [SSOSecretKey.OktaDomain]: "--okta-domain",
  [SSOSecretKey.JwksUri]: "--jwks-uri",
};

function secretKeyToFlag(key: SSOSecretKey): string {
  return SECRET_KEY_TO_FLAG[key];
}

function exampleCommand(provider: KnownSSOProvider): string {
  let cmd = `base44 auth sso enable --provider ${provider} --client-id <id> --client-secret <secret>`;
  if (provider === KNOWN_SSO_PROVIDERS.microsoft) cmd += " --tenant-id <id>";
  if (provider === KNOWN_SSO_PROVIDERS.okta) cmd += " --okta-domain <domain>";
  if (provider === KNOWN_SSO_PROVIDERS.custom)
    cmd +=
      " --sso-name <name> --auth-endpoint <url> --token-endpoint <url> --userinfo-endpoint <url> --jwks-uri <url>";
  return cmd;
}

function validateProvider(provider: string | undefined): KnownSSOProvider {
  if (!provider) {
    throw new InvalidInputError("Missing --provider.", {
      hints: [
        {
          message: `Valid providers: ${providerNames.join(", ")}`,
          command:
            "base44 auth sso enable --provider <provider> --client-id <id> --client-secret <secret>",
        },
      ],
    });
  }

  return provider as KnownSSOProvider;
}

async function ssoEnableAction(
  { isNonInteractive, runTask }: CLIContext,
  options: SSOOptions,
): Promise<RunCommandResult> {
  if (options.file && options.envFile) {
    throw new InvalidInputError(
      "--file and --env-file cannot be used together. Provide the client secret either inside --file or via --env-file.",
    );
  }

  // Load file config if provided
  let merged = options;
  if (options.file) {
    const fileConfig = await loadSSOConfigFile(options.file);
    merged = mergeFileWithFlags(fileConfig, options);
  }

  const provider = validateProvider(merged.provider);

  // Validate --client-id is present
  if (!merged.clientId) {
    throw new InvalidInputError("Missing --client-id.", {
      hints: [
        {
          message: `Example: base44 auth sso enable --provider ${provider} --client-id <id> --client-secret <secret>`,
          command: `base44 auth sso enable --provider ${provider} --client-id <id> --client-secret <secret>`,
        },
      ],
    });
  }

  // Resolve client secret via flag, stdin, env file, or env var
  let clientSecret: string;
  if (merged.envFile && !merged.clientSecret) {
    const secrets = await parseEnvFile(resolve(merged.envFile));
    const value = secrets.sso_client_secret;
    if (!value) {
      throw new InvalidInputError(
        `Key "sso_client_secret" not found in ${merged.envFile}.`,
      );
    }
    clientSecret = value;
  } else {
    clientSecret = await resolveSecret({
      flagValue: merged.clientSecret,
      fromStdin: merged.clientSecretStdin,
      envVar: "sso_client_secret",
      promptMessage: "Enter SSO client secret",
      isNonInteractive,
      name: "client secret",
      hints: [
        {
          message: `Provide via flag:   base44 auth sso enable --provider ${provider} --client-id <id> --client-secret <secret>`,
          command: `base44 auth sso enable --provider ${provider} --client-id <id> --client-secret <secret>`,
        },
        {
          message: `Provide via stdin:  echo <secret> | base44 auth sso enable --provider ${provider} --client-id <id> --client-secret-stdin`,
        },
        {
          message: `Provide via env:    sso_client_secret=<secret> base44 auth sso enable --provider ${provider} --client-id <id>`,
        },
      ],
    });
  }

  // Build and validate secrets payload
  const secretOptions: SSOSecretOptions = {
    clientId: merged.clientId,
    clientSecret,
    scope: merged.scope,
    discoveryUrl: merged.discoveryUrl,
    tenantId: merged.tenantId,
    oktaDomain: merged.oktaDomain,
    authEndpoint: merged.authEndpoint,
    tokenEndpoint: merged.tokenEndpoint,
    userinfoEndpoint: merged.userinfoEndpoint,
    jwksUri: merged.jwksUri,
    ssoName: merged.ssoName,
  };

  let secrets: Record<string, string>;
  try {
    secrets = buildSSOSecrets(provider, secretOptions);
  } catch (error) {
    if (error instanceof MissingSSOFieldsError) {
      const flagNames = error.missingKeys.map(secretKeyToFlag);
      throw new InvalidInputError(
        `Missing required fields for ${error.provider}: ${flagNames.join(", ")}`,
        {
          hints: [
            {
              message: `Example: ${exampleCommand(provider)}`,
              command: exampleCommand(provider),
            },
          ],
        },
      );
    }
    throw error;
  }

  // Update local auth config
  const { project } = await readProjectConfig();
  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  await runTask("Updating local auth config", async () =>
    updateSSOConfig(authDir, provider, true),
  );

  // Push secrets to backend
  await runTask("Saving SSO credentials", async () => pushSSOSecrets(secrets));

  return {
    outroMessage: `SSO configured with ${provider} in local config. Run \`base44 auth push\` or \`base44 deploy\` to apply.`,
  };
}

/** Returns true if any flag intended for `enable` was passed. */
function hasEnableOnlyOptions(options: SSOOptions): boolean {
  return Boolean(
    options.provider ||
      options.clientId ||
      options.clientSecret ||
      options.clientSecretStdin ||
      options.envFile ||
      options.file ||
      options.scope ||
      options.discoveryUrl ||
      options.tenantId ||
      options.oktaDomain ||
      options.authEndpoint ||
      options.tokenEndpoint ||
      options.userinfoEndpoint ||
      options.jwksUri ||
      options.ssoName,
  );
}

async function ssoDisableAction(
  { log, runTask }: CLIContext,
  options: SSOOptions,
): Promise<RunCommandResult> {
  if (hasEnableOnlyOptions(options)) {
    throw new InvalidInputError(
      "Configuration options cannot be used with disable. To disable SSO: base44 auth sso disable",
    );
  }

  const { project } = await readProjectConfig();
  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  const updated = await runTask("Updating local auth config", async () =>
    updateSSOConfig(authDir, null, false),
  );

  await runTask("Removing SSO credentials", async () => deleteSSOSecrets());

  if (!hasAnyLoginMethod(updated)) {
    log.warn(
      "Disabling SSO will leave no login methods enabled. Users will be locked out.",
    );
  }

  return {
    outroMessage:
      "SSO disabled in local config and credentials removed. Run `base44 auth push` or `base44 deploy` to apply.",
  };
}

async function ssoAction(
  context: CLIContext,
  action: "enable" | "disable",
  options: SSOOptions,
): Promise<RunCommandResult> {
  if (action === "disable") {
    return ssoDisableAction(context, options);
  }
  return ssoEnableAction(context, options);
}

export function getSSOCommand(): Command {
  return new Base44Command("sso")
    .description(
      "Configure SSO identity provider (google, microsoft, github, okta, custom). SSO and social login are mutually exclusive — enabling one disables the other in the local auth config.",
    )
    .addArgument(
      new Argument("<action>", "enable or disable SSO").choices([
        "enable",
        "disable",
      ]),
    )
    .addOption(
      new Option("--provider <provider>", "SSO provider").choices(
        Object.values(KNOWN_SSO_PROVIDERS),
      ),
    )
    .option("--client-id <id>", "OAuth client ID")
    .option("--client-secret <secret>", "OAuth client secret")
    .option("--client-secret-stdin", "Read client secret from stdin")
    .option(
      "--env-file <path>",
      "Read client secret from a .env file (key: sso_client_secret)",
    )
    .option("--file <path>", "JSON config file with all SSO settings")
    .option("--scope <scope>", "OAuth scope (defaults per provider)")
    .option("--discovery-url <url>", "OIDC discovery URL")
    .option("--tenant-id <id>", "Microsoft tenant ID (required for microsoft)")
    .option("--okta-domain <domain>", "Okta domain (required for okta)")
    .option(
      "--auth-endpoint <url>",
      "Authorization endpoint (required for custom)",
    )
    .option("--token-endpoint <url>", "Token endpoint (required for custom)")
    .option(
      "--userinfo-endpoint <url>",
      "Userinfo endpoint (required for custom)",
    )
    .option("--jwks-uri <url>", "JWKS URI (required for custom)")
    .option("--sso-name <name>", "Provider display name (required for custom)")
    .action(ssoAction);
}
