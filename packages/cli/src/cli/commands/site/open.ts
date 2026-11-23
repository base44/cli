import type { Command } from "commander";
import open from "open";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { ApiError, AppNotPublishedError } from "@/core/errors.js";
import { getSiteUrl } from "@/core/project/index.js";

const isAppNotPublished = (error: unknown) =>
  error instanceof ApiError && error.statusCode === 404;

async function getPublishedSiteUrl() {
  try {
    return await getSiteUrl();
  } catch (error) {
    throw isAppNotPublished(error) ? new AppNotPublishedError() : error;
  }
}

async function openAction({
  isNonInteractive,
}: CLIContext): Promise<RunCommandResult> {
  const siteUrl = await getPublishedSiteUrl();

  if (!isNonInteractive) {
    await open(siteUrl);
  }

  return { outroMessage: `Site opened at ${siteUrl}` };
}

export function getSiteOpenCommand(): Command {
  return new Base44Command("open")
    .description("Open the published site in your browser")
    .action(openAction);
}
