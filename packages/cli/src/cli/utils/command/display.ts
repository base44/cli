import { intro, log, outro } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { printBanner } from "@/cli/utils/banner.js";
import { theme } from "@/cli/utils/theme.js";
import { printUpgradeNotification } from "@/cli/utils/upgradeNotification.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";
import { isCLIError } from "@/core/errors.js";

export interface RunCommandResult {
  outroMessage?: string;
  /**
   * Raw text to write to stdout after the command UI (intro/outro) finishes.
   * Useful for commands that produce machine-readable or pipeable output.
   */
  stdout?: string;
}

/**
 * Show the intro banner or simple tag.
 */
export async function showIntro(
  fullBanner: boolean,
  isNonInteractive: boolean,
): Promise<void> {
  if (fullBanner) {
    await printBanner(isNonInteractive);
    intro("");
  } else {
    intro(theme.colors.base44OrangeBackground(" Base 44 "));
  }
}

/**
 * Show the outro: upgrade notification, outro message, and optional stdout.
 */
export async function showOutro(
  result: RunCommandResult,
  upgradeCheckPromise: Promise<UpgradeInfo | null>,
  distribution: CLIContext["distribution"],
): Promise<void> {
  await printUpgradeNotification(upgradeCheckPromise, distribution);
  outro(result.outroMessage || "");

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

/**
 * Display an error to the user.
 *
 * When `quiet` is true (non-interactive / CI), writes a plain error message
 * to stderr without clack formatting or ASCII codes.
 * When `quiet` is false, uses clack log and themed formatting.
 */
export function showError(
  error: unknown,
  context: CLIContext,
  quiet: boolean,
): void {
  if (quiet) {
    showPlainError(error);
  } else {
    showThemedError(error);
    const errorContext = context.errorReporter.getErrorContext();
    outro(theme.format.errorContext(errorContext));
  }
}

function showThemedError(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log.error(errorMessage);

  if (isCLIError(error)) {
    if (error.details.length > 0) {
      log.info(theme.format.details(error.details));
    }

    const hints = theme.format.agentHints(error.hints);
    if (hints) {
      log.error(hints);
    }
  }

  if (process.env.DEBUG === "1" && error instanceof Error && error.stack) {
    log.error(theme.styles.dim(error.stack));
  }
}

function showPlainError(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${errorMessage}\n`);

  if (isCLIError(error)) {
    for (const detail of error.details) {
      process.stderr.write(`  ${detail}\n`);
    }
    for (const hint of error.hints) {
      const cmd = hint.command ? ` (${hint.command})` : "";
      process.stderr.write(`  Hint: ${hint.message}${cmd}\n`);
    }
  }

  if (process.env.DEBUG === "1" && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
}
