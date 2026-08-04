import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { getSiteUrl } from "@/core/project/index.js";
import { updateSlug } from "@/core/slug/index.js";
import { logAppUrl, toJsonStdout } from "./shared.js";

async function resetSlugAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  const result = await runTask(
    "Resetting slug...",
    async () => {
      const updated = await updateSlug(null);
      return { slug: updated.slug, url: await getSiteUrl() };
    },
    { errorMessage: "Failed to reset slug" },
  );

  if (jsonMode) {
    return {
      outroMessage: `Slug reset to ${result.slug}`,
      stdout: toJsonStdout(result),
    };
  }

  log.message(
    `${theme.styles.header("Slug")}: ${theme.styles.bold(result.slug ?? "")}`,
  );
  logAppUrl(result.url, log);
  return { outroMessage: `Slug reset to ${result.slug}` };
}

export function getSlugResetCommand(): Command {
  return new Base44Command("reset")
    .description("Reset the slug to an auto-generated one")
    .action(resetSlugAction);
}
