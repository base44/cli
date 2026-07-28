import type { Logger } from "@base44-cli/logger";
import { confirm, isCancel } from "@clack/prompts";
import { InvalidInputError } from "@/core/errors.js";

interface ConfirmPushOptions {
  isNonInteractive: boolean;
  yes: boolean | undefined;
  log: Logger;
  warning: string;
}

/**
 * Guard a destructive push: in non-interactive mode require --yes (throws
 * otherwise, so --json/CI never hang on a prompt); interactively, warn and
 * ask for confirmation. Returns false when the user declines.
 */
export async function confirmPush({
  isNonInteractive,
  yes,
  log,
  warning,
}: ConfirmPushOptions): Promise<boolean> {
  if (isNonInteractive && !yes) {
    throw new InvalidInputError("--yes is required in non-interactive mode");
  }
  if (yes) {
    return true;
  }
  log.warn(warning);
  const proceed = await confirm({
    message: "Are you sure you want to continue?",
  });
  return !isCancel(proceed) && proceed;
}
