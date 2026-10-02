import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import {
  clearStoredTarget,
  getBase44ApiUrl,
  getTargetFilePath,
  readStoredTarget,
  writeStoredTarget,
} from "@/core/config.js";
import { InvalidInputError } from "@/core/errors.js";

interface TargetOptions {
  ff?: string;
  clear?: boolean;
}

async function targetAction(
  { log, jsonMode }: CLIContext,
  url: string | undefined,
  options: TargetOptions,
): Promise<RunCommandResult> {
  if (options.clear) {
    clearStoredTarget();
    return {
      outroMessage: "Target cleared — commands hit production again.",
    };
  }

  if (!url && !options.ff) {
    const stored = readStoredTarget();
    const active = getBase44ApiUrl();
    if (jsonMode) {
      return {
        stdout: `${JSON.stringify({
          active_api_url: active,
          stored_api_url: stored.apiUrl ?? null,
          ff_override: stored.ffOverride ?? null,
        })}\n`,
      };
    }
    log.message(
      `active  ${active}${stored.apiUrl ? "" : "  (production default)"}`,
    );
    if (stored.ffOverride) log.message(`ff      ${stored.ffOverride}`);
    return {
      outroMessage: stored.apiUrl
        ? `Stored in ${getTargetFilePath()} — clear with \`base44 target --clear\`.`
        : "No stored target.",
    };
  }

  if (url && !/^https?:\/\//.test(url)) {
    throw new InvalidInputError(
      "Target must be a full URL, e.g. https://docker-pr-24793.velino.org",
    );
  }
  const previous = readStoredTarget();
  const next = {
    apiUrl: url ?? previous.apiUrl,
    ffOverride: options.ff ?? previous.ffOverride,
  };
  writeStoredTarget(next);
  const ff = next.ffOverride ? ` (X-FF-Override: ${next.ffOverride})` : "";
  return {
    outroMessage: `Every base44 command now targets ${next.apiUrl ?? getBase44ApiUrl()}${ff}. Back to production: \`base44 target --clear\`.`,
  };
}

export function getTargetCommand(): Base44Command {
  const command = new Base44Command("target", {
    requireAuth: false,
    requireAppContext: false,
  });
  command
    .description(
      "Point every command at a staging/preview host (persisted). No arguments shows the current target; --clear returns to production",
    )
    .argument("[url]", "API base URL, e.g. https://docker-pr-24793.velino.org")
    .option(
      "--ff <override>",
      'Feature-flag override header sent on every request (staging only), e.g. "imported-apps:true"',
    )
    .option("--clear", "Remove the stored target (back to production)")
    .action(targetAction);
  return command;
}
