import { release, type } from "node:os";
import type { ErrorContext } from "@/cli/telemetry/error-reporter.js";
import { isCLIError, isUserError } from "@/core/errors.js";
import packageJson from "../../../../package.json";

const ISSUES_URL = "https://github.com/base44/cli/issues/new";
const MAX_MESSAGE_LENGTH = 300;

/**
 * Whether an error warrants pointing the user at the bug tracker. User
 * errors (bad input, missing auth) are expected and actionable via hints;
 * everything else is a bug worth reporting.
 */
export function shouldOfferBugReport(error: unknown): boolean {
  return !isCLIError(error) || !isUserError(error);
}

/**
 * Build a GitHub new-issue URL pre-filled with the error message, CLI
 * version, and environment details, so filing a bug requires no manual
 * information gathering.
 */
export function buildBugReportUrl(error: unknown, ctx: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error);
  const truncated =
    message.length > MAX_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
      : message;
  const code = isCLIError(error) ? error.code : "UNEXPECTED";

  const title = `[bug] ${code}: ${truncated.split("\n")[0]?.slice(0, 80)}`;
  const body = [
    "## What happened?",
    "",
    "<!-- Describe what you were doing when the error occurred -->",
    "",
    "## Error",
    "",
    "```",
    truncated,
    "```",
    "",
    "## Environment",
    "",
    `- CLI version: ${packageJson.version}`,
    ctx.command?.name ? `- Command: base44 ${ctx.command.name}` : null,
    ctx.sessionId ? `- Session: ${ctx.sessionId}` : null,
    `- OS: ${type()} ${release()} (${process.platform}/${process.arch})`,
    `- Node.js: ${process.version}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const params = new URLSearchParams({ title, body });
  return `${ISSUES_URL}?${params.toString()}`;
}
