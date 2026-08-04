import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { theme } from "@/cli/utils/index.js";
import { getSiteUrl } from "@/core/project/index.js";
import { getSlug } from "@/core/slug/index.js";
import { logAppUrl, toJsonStdout } from "./shared.js";

export async function showSlugAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  const { slug, url } = await runTask(
    "Fetching slug...",
    async () => {
      const { slug } = await getSlug();
      return { slug, url: slug ? await getSiteUrl() : null };
    },
    { errorMessage: "Failed to fetch slug" },
  );

  if (jsonMode) {
    return {
      outroMessage: slug ? `Slug: ${slug}` : "This app has no slug yet",
      stdout: toJsonStdout({ slug, url }),
    };
  }

  if (!slug) {
    return {
      outroMessage:
        "This app has no slug yet — set one with 'base44 slug set <slug>'",
    };
  }

  log.message(`${theme.styles.header("Slug")}: ${theme.styles.bold(slug)}`);
  if (url) {
    logAppUrl(url, log);
  }
  return { outroMessage: `Slug: ${slug}` };
}
