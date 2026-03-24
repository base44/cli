import { resolve } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { setSecrets } from "@/core/resources/secret/index.js";
import { parseEnvFile } from "@/core/utils/index.js";

function parseEntries(entries: string[]): Record<string, string> {
  const secrets: Record<string, string> = {};

  for (const entry of entries) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex === -1) {
      throw new InvalidInputError(
        `Invalid format: "${entry}". Expected KEY=VALUE.`,
      );
    }

    const key = entry.slice(0, eqIndex);
    const value = entry.slice(eqIndex + 1);

    if (!key) {
      throw new InvalidInputError(
        `Invalid format: "${entry}". Key cannot be empty.`,
      );
    }

    secrets[key] = value;
  }

  return secrets;
}

function validateInput(entries: string[], options: { envFile?: string }): void {
  const hasEntries = entries.length > 0;
  const hasEnvFile = Boolean(options.envFile);

  if (!hasEntries && !hasEnvFile) {
    throw new InvalidInputError(
      "Provide KEY=VALUE pairs or use --env-file. Example: base44 secrets set KEY1=VALUE1 KEY2=VALUE2",
    );
  }

  if (hasEntries && hasEnvFile) {
    throw new InvalidInputError(
      "Provide KEY=VALUE pairs or --env-file, but not both.",
    );
  }
}

async function setSecretsAction(
  { log, runTask }: CLIContext,
  entries: string[],
  options: { envFile?: string },
): Promise<RunCommandResult> {
  validateInput(entries, options);

  let secrets: Record<string, string>;

  if (options.envFile) {
    secrets = await parseEnvFile(resolve(options.envFile as string));
    if (Object.keys(secrets).length === 0) {
      throw new InvalidInputError(
        "The env file contains no valid KEY=VALUE entries.",
      );
    }
  } else {
    secrets = parseEntries(entries);
  }

  const names = Object.keys(secrets);

  await runTask(
    `Setting ${names.length} secrets`,
    async () => {
      return await setSecrets(secrets);
    },
    {
      successMessage: `${names.length} secrets set successfully`,
      errorMessage: "Failed to set secrets",
    },
  );

  log.info(`Set: ${names.join(", ")}`);

  return {
    outroMessage: "Secrets set successfully.",
  };
}

export function getSecretsSetCommand(): Command {
  return new Base44Command("set")
    .description("Set one or more secrets (KEY=VALUE format)")
    .argument("[entries...]", "KEY=VALUE pairs (e.g. KEY1=VALUE1 KEY2=VALUE2)")
    .option("--env-file <path>", "Path to .env file")
    .action(setSecretsAction);
}
