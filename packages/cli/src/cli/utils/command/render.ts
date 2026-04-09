import { intro, log, outro } from "@clack/prompts";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { printBanner } from "@/cli/utils/banner.js";
import { theme } from "@/cli/utils/theme.js";
import { isCLIError } from "@/core/errors.js";
import type { StaleSkillInfo } from "./skill-version-check.js";
import { printSkillVersionWarning } from "./skill-version-check.js";
import { printUpgradeNotification } from "./upgradeNotification.js";
import type { UpgradeInfo } from "./version-check.js";

/**
 * Show the command start UI: intro banner or simple tag.
 */
export async function showCommandStart(fullBanner: boolean): Promise<void> {
  if (fullBanner) {
    await printBanner();
    intro("");
  } else {
    intro(theme.colors.base44OrangeBackground(" Base 44 "));
  }
}

/**
 * Show the command end UI: upgrade notification, outro message, and stdout.
 */
interface CommandEndOptions {
  upgradeCheck: Promise<UpgradeInfo | null>;
  skillCheck: Promise<StaleSkillInfo[] | null>;
  distribution: CLIContext["distribution"];
}

export async function showCommandEnd(
  result: RunCommandResult,
  options: CommandEndOptions,
): Promise<void> {
  await Promise.all([
    printUpgradeNotification(options.upgradeCheck, options.distribution),
    printSkillVersionWarning(options.skillCheck),
  ]);
  outro(result.outroMessage || "");

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

/**
 * Display an error with clack-themed formatting (interactive mode).
 */
export function showThemedError(error: unknown, context: CLIContext): void {
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

  const errorContext = context.errorReporter.getErrorContext();
  outro(theme.format.errorContext(errorContext));
}

/**
 * Display an error as plain text to stderr (non-interactive / CI mode).
 */
export function showPlainError(error: unknown): void {
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
