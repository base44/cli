import { resolve } from "node:path";
import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { InvalidInputError } from "@/core/errors.js";
import { setSecrets } from "@/core/resources/secret/index.js";
import { parseEnvFile } from "@/core/utils/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

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

function validateInput(command: Command): void {
  const entries = command.args;
  const { envFile } = command.opts<{ envFile?: string }>();
  const hasEntries = entries.length > 0;
  const hasEnvFile = Boolean(envFile);

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
  entries: string[],
  options: { envFile?: string },
): Promise<RunCommandResult> {
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

export function getSecretsSetCommand(context: CLIContext): Command {
  return new Command("set")
    .description("Set one or more secrets (KEY=VALUE format)")
    .argument("[entries...]", "KEY=VALUE pairs (e.g. KEY1=VALUE1 KEY2=VALUE2)")
    .option("--env-file <path>", "Path to .env file")
    .hook("preAction", validateInput)
    .action(async (entries: string[], options: { envFile?: string }) => {
      await runCommand(
        () => setSecretsAction(entries, options),
        { requireAuth: true },
        context,
      );
    });
}
