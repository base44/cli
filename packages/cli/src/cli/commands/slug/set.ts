import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { getSiteUrl } from "@/core/project/index.js";
import { getSlug, updateSlug } from "@/core/slug/index.js";
import { logAppUrl, toJsonStdout } from "./shared.js";

async function setSlugAction(
  { log, runTask, jsonMode }: CLIContext,
  slug: string,
): Promise<RunCommandResult> {
  const result = await runTask(
    `Setting slug to ${slug}...`,
    async () => {
      const { slug: previousSlug } = await getSlug();
      const updated = await updateSlug(slug);
      return { previousSlug, slug: updated.slug, url: await getSiteUrl() };
    },
    { errorMessage: "Failed to update slug" },
  );

  if (jsonMode) {
    return {
      outroMessage: `Slug set to ${result.slug}`,
      stdout: toJsonStdout(result),
    };
  }

  log.message(
    `${theme.styles.header("Slug")}: ${result.previousSlug ?? "(none)"} ${theme.styles.dim("→")} ${theme.styles.bold(result.slug ?? "")}`,
  );
  logAppUrl(result.url, log);
  return { outroMessage: `Slug set to ${result.slug}` };
}

export function getSlugSetCommand(): Command {
  return new Base44Command("set")
    .description("Set a custom slug for this app")
    .argument(
      "<slug>",
      "New slug, e.g. my-app (3-50 chars: lowercase letters, numbers, hyphens)",
    )
    .action(setSlugAction);
}
