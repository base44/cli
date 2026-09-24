import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import type { ImportedGitStatus } from "@/core/resources/imported/api.js";
import {
  commitImportedChanges,
  discardImportedChanges,
  getImportedGitStatus,
  getImportedPreviewUrl,
  openImportedPullRequest,
} from "@/core/resources/imported/api.js";

function statusLines(status: ImportedGitStatus): string[] {
  const position = [
    status.ahead != null ? `ahead ${status.ahead}` : null,
    status.behind != null ? `behind ${status.behind}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    `Branch:  ${status.current_branch} (default: ${status.default_branch}${position ? `; ${position}` : ""})`,
    `Head:    ${status.head ? status.head.slice(0, 10) : "none"}`,
    `Tree:    ${status.dirty ? `dirty — ${status.dirty_files.length} file(s)` : "clean"}`,
  ];
  for (const file of status.dirty_files.slice(0, 20)) lines.push(`  ${file}`);
  if (status.merge_in_progress) lines.push("Merge in progress!");
  return lines;
}

function statusResult(
  status: ImportedGitStatus,
  { log, jsonMode }: CLIContext,
  outroMessage: string,
): RunCommandResult {
  if (jsonMode) return { stdout: `${JSON.stringify(status)}\n` };
  for (const line of statusLines(status)) log.message(line);
  return { outroMessage };
}

async function statusAction(ctx: CLIContext): Promise<RunCommandResult> {
  const status = await ctx.runTask("Reading sandbox git status", () =>
    getImportedGitStatus(ctx.branchId),
  );
  return statusResult(status, ctx, "Status read.");
}

async function commitAction(
  ctx: CLIContext,
  options: { message?: string },
): Promise<RunCommandResult> {
  const status = await ctx.runTask("Committing and pushing", () =>
    commitImportedChanges(options.message, ctx.branchId),
  );
  return statusResult(status, ctx, "Committed and pushed.");
}

async function discardAction(ctx: CLIContext): Promise<RunCommandResult> {
  const status = await ctx.runTask("Discarding uncommitted changes", () =>
    discardImportedChanges(ctx.branchId),
  );
  return statusResult(status, ctx, "Uncommitted changes discarded.");
}

async function prAction(
  ctx: CLIContext,
  options: { title?: string; body?: string },
): Promise<RunCommandResult> {
  const title = options.title?.trim();
  if (!title) {
    throw new InvalidInputError("--title is required to open a pull request.");
  }
  const pr = await ctx.runTask("Opening pull request", () =>
    openImportedPullRequest(title, options.body ?? "", ctx.branchId),
  );
  const url = pr.html_url ?? pr.url;
  if (ctx.jsonMode) {
    return {
      stdout: `${JSON.stringify({ url: url ?? null, number: pr.number ?? null, created: pr.created ?? null })}\n`,
    };
  }
  if (url) ctx.log.message(url);
  return {
    outroMessage:
      pr.created === false
        ? "This branch already has a pull request."
        : "Pull request opened.",
  };
}

async function previewAction(ctx: CLIContext): Promise<RunCommandResult> {
  const url = await ctx.runTask(
    "Resolving preview URL (boots the sandbox if needed)",
    () => getImportedPreviewUrl(),
  );
  if (ctx.jsonMode)
    return { stdout: `${JSON.stringify({ preview_url: url })}\n` };
  ctx.log.message(url);
  return { outroMessage: "Preview is live." };
}

export function getImportedStatusCommand(): Base44Command {
  const command = new Base44Command("status", { supportsBranch: true });
  command
    .description("Show the sandbox checkout's git status")
    .action(statusAction);
  return command;
}

export function getImportedCommitCommand(): Base44Command {
  const command = new Base44Command("commit", { supportsBranch: true });
  command
    .description("Commit and push uncommitted sandbox changes")
    .option(
      "-m, --message <message>",
      "Commit message (generated when omitted)",
    )
    .action(commitAction);
  return command;
}

export function getImportedDiscardCommand(): Base44Command {
  const command = new Base44Command("discard", { supportsBranch: true });
  command
    .description("Throw away uncommitted sandbox changes")
    .action(discardAction);
  return command;
}

export function getImportedPrCommand(): Base44Command {
  const command = new Base44Command("pr", { supportsBranch: true });
  command
    .description("Open a pull request for the app's working branch")
    .option("--title <title>", "Pull request title")
    .option("--body <body>", "Pull request body (markdown)")
    .action(prAction);
  return command;
}

export function getImportedPreviewCommand(): Base44Command {
  const command = new Base44Command("preview");
  command.description("Print the app's live preview URL").action(previewAction);
  return command;
}
