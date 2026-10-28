import { cancel, isCancel, select } from "@clack/prompts";
import type { Command } from "commander";
import ms from "ms";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  ensureAuth,
  requireApp,
  toJsonStdout,
} from "@/cli/utils/index.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { InvalidInputError } from "@/core/errors.js";
import { MAX_SESSION_BYTES, uploadSession } from "@/core/session-import/api.js";
import {
  findCurrentSession,
  type LocalSession,
  listSessions,
  parseSessionLink,
  teleportSession,
} from "@/core/session-import/sessions.js";
import { readFile } from "@/core/utils/fs.js";
import { readGitState } from "@/core/utils/git.js";

interface ImportOptions {
  current?: boolean;
  file?: string;
  token?: string;
  skipPushCheck?: boolean;
}

const TOOL_LABELS: Record<LocalSession["tool"], string> = {
  claude_code: "Claude Code",
  codex: "Codex",
};

async function pickSession(cwd: string): Promise<string> {
  const sessions = await listSessions(cwd);
  if (sessions.length === 0) {
    throw new InvalidInputError(
      "No Claude Code or Codex sessions found in this folder. Pass --file <path>.",
    );
  }
  const choice = await select({
    message: "Which session do you want to continue in Base Code?",
    options: sessions.map((session) => ({
      value: session.path,
      label: session.firstMessage.replace(/\s+/g, " ").slice(0, 70),
      hint: `${TOOL_LABELS[session.tool]}, ${ms(Date.now() - session.updatedAt.getTime())} ago`,
    })),
  });
  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    throw new CLIExitError(0);
  }
  return choice;
}

async function readSession(
  ctx: CLIContext,
  link: string | undefined,
  options: ImportOptions,
): Promise<Uint8Array> {
  const cwd = process.cwd();
  if (options.file) return readFile(options.file);
  if (link) {
    const sessionId = parseSessionLink(link);
    const content = await ctx.runTask("Downloading the claude.ai session", () =>
      teleportSession(sessionId, cwd),
    );
    return Buffer.from(content);
  }
  if (options.current) {
    const path = await findCurrentSession(cwd);
    if (!path) {
      throw new InvalidInputError(
        "Couldn't find the current session. Run this from inside Claude Code or Codex, or pass --file <path>.",
        { hints: [] },
      );
    }
    return readFile(path);
  }
  if (ctx.isNonInteractive || ctx.jsonMode) {
    throw new InvalidInputError(
      "Choose a session: pass --current, a claude.ai session link, or --file <path>.",
    );
  }
  return readFile(await pickSession(cwd));
}

async function importAction(
  ctx: CLIContext,
  link: string | undefined,
  options: ImportOptions,
  command: Command,
): Promise<RunCommandResult> {
  // First: the transcript link and the key must never reach error reporting.
  ctx.errorReporter.setContext({
    command: {
      name: "sessions import",
      args: link ? ["[not reported]"] : [],
      options: {
        ...command.opts(),
        ...(options.token ? { token: "[not reported]" } : {}),
      },
    },
  });
  const chosen = [link, options.current, options.file].filter(Boolean).length;
  if (chosen > 1) {
    throw new InvalidInputError(
      "Pass only one of: a session link, --current, or --file.",
    );
  }

  const appId = requireApp(ctx).id;
  const content = await readSession(ctx, link, options);
  if (content.length > MAX_SESSION_BYTES) {
    throw new InvalidInputError(
      "This session is over 25 MB and can't be imported.",
      { hints: [] },
    );
  }
  // A link's changes live in the cloud session and --file may come from
  // anywhere, so only a session from this checkout is held to its git state.
  const git =
    link || options.file ? undefined : await readGitState(process.cwd());
  if (git?.unpushed && !options.skipPushCheck) {
    throw new InvalidInputError(
      "Your changes aren't on GitHub yet. Ask the user whether to commit and push them (to a new branch if on main or master), then run this again. If they don't want to, run it again with --skip-push-check.",
      { hints: [] },
    );
  }
  const note = git?.unpushed
    ? "Base Code started from what's on GitHub; your local changes aren't included."
    : undefined;

  if (!options.token) await ensureAuth(ctx);

  ctx.log.info("This uploads the full conversation to Base Code.");
  const imported = await ctx.runTask("Importing session", () =>
    uploadSession(appId, content, {
      token: options.token,
      sourceBranch: git?.branch,
    }),
  );
  const url = `${getBase44ApiUrl()}${imported.branchUrl}`;
  return {
    outroMessage: [
      imported.continued
        ? `✓ Imported ${imported.turnCount} messages from ${TOOL_LABELS[imported.source]}. Continued on "${imported.branchName}".`
        : `✓ Imported ${imported.turnCount} messages from ${TOOL_LABELS[imported.source]} into branch "${imported.branchName}".`,
      ...(note ? [note] : []),
      `Open it: ${url}`,
    ].join("\n"),
    stdout: ctx.jsonMode
      ? toJsonStdout({ ...imported, url, ...(note ? { note } : {}) })
      : undefined,
  };
}

export function getSessionsImportCommand(): Command {
  return new Base44Command("import", { requireAuth: false })
    .description("Continue a Claude Code or Codex session in Base Code")
    .argument(
      "[session-link]",
      "A claude.ai session address (https://claude.ai/code/session_…)",
    )
    .option("--current", "Import the session this command runs inside")
    .option("--file <path>", "Import this session file as is")
    .option(
      "--skip-push-check",
      "Import even though local changes aren't on GitHub (they won't be included)",
    )
    .option(
      "--token <key>",
      "One-time import key from Base Code (no login needed)",
    )
    .action(importAction);
}
