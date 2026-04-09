import { isCancel, password } from "@clack/prompts";
import { CLIExitError } from "@/cli/errors.js";
import type { ErrorHint } from "@/core/errors.js";
import { InvalidInputError } from "@/core/errors.js";
import { readStdin } from "./stdin.js";

interface SecretInputOptions {
  /** Value from a CLI flag (e.g., --client-secret <value>) */
  flagValue?: string;
  /** Whether to read from stdin (e.g., --client-secret-stdin was set) */
  fromStdin?: boolean;
  /** Environment variable name to check (e.g., "BASE44_GOOGLE_CLIENT_SECRET") */
  envVar?: string;
  /** Prompt message for interactive fallback */
  promptMessage: string;
  /** Whether we're in non-interactive mode (from CLIContext) */
  isNonInteractive: boolean;
  /** Name of the secret for error messages (e.g., "client secret") */
  name: string;
  /** Hint commands to show in error when secret is missing in non-interactive mode */
  hints?: ErrorHint[];
}

/**
 * Resolves a secret value through a precedence chain:
 * stdin > flag value > environment variable > interactive masked prompt
 *
 * In non-interactive mode, throws InvalidInputError with hints if no value is available.
 * Reusable by any command that needs to collect a secret from the user.
 */
export async function resolveSecret(
  options: SecretInputOptions,
): Promise<string> {
  // 1. Stdin (highest precedence — safest, no shell history)
  if (options.fromStdin) {
    const value = await readStdin("--client-secret-stdin");
    if (value) return value;
  }

  // 2. Flag value
  if (options.flagValue) {
    return options.flagValue;
  }

  // 3. Environment variable
  if (options.envVar) {
    const envValue = process.env[options.envVar];
    if (envValue) return envValue;
  }

  // 4. Interactive masked prompt (lowest precedence)
  if (!options.isNonInteractive) {
    const value = await password({
      message: options.promptMessage,
      validate: (v) => {
        if (!v || v.trim().length === 0) {
          return `${options.name} is required`;
        }
      },
    });

    if (isCancel(value)) {
      throw new CLIExitError(0);
    }

    return value;
  }

  // Non-interactive and no value resolved — throw with hints
  throw new InvalidInputError(`Missing required ${options.name}.`, {
    hints: options.hints ?? [
      {
        message: `Provide the ${options.name} via flag, stdin, or environment variable (${options.envVar ?? "N/A"})`,
      },
    ],
  });
}
