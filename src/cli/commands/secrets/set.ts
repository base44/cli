import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { InvalidInputError } from "@/core/errors.js";
import { parseEnvFile, setSecrets } from "@/core/resources/secret/index.js";
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

async function setSecretsAction(
  entries: string[],
  options: { envFile?: string },
): Promise<RunCommandResult> {
  const hasEntries = entries.length > 0;
  const hasEnvFile = Boolean(options.envFile);

  if (!hasEntries && !hasEnvFile) {
    throw new InvalidInputError(
      "Provide KEY=VALUE pairs or --env-file, but not neither.",
    );
  }

  if (hasEntries && hasEnvFile) {
    throw new InvalidInputError(
      "Provide KEY=VALUE pairs or --env-file, but not both.",
    );
  }

  let secrets: Record<string, string>;

  if (hasEnvFile) {
    secrets = await parseEnvFile(options.envFile as string);
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
    `Setting ${names.length} secret${names.length === 1 ? "" : "s"}`,
    async () => {
      return await setSecrets(secrets);
    },
    {
      successMessage: `${names.length} secret${names.length === 1 ? "" : "s"} set successfully`,
      errorMessage: "Failed to set secrets",
    },
  );

  log.info(`Set: ${names.join(", ")}`);

  return {
    outroMessage:
      "Secrets saved. Your app will automatically redeploy with the new values.",
  };
}

export function getSecretsSetCommand(context: CLIContext): Command {
  return new Command("set")
    .description("Set one or more secrets (KEY=VALUE format)")
    .argument("[entries...]", "KEY=VALUE pairs (e.g. OPENAI_API_KEY=sk-abc123)")
    .option("--env-file <path>", "Path to .env file")
    .action(async (entries: string[], options: { envFile?: string }) => {
      await runCommand(
        () => setSecretsAction(entries, options),
        { requireAuth: true },
        context,
      );
    });
}
