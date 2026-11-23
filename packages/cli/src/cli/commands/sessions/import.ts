import { cancel, isCancel, select } from "@clack/prompts";
import { type Command, Option } from "commander";
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
import { collectArtifacts } from "@/core/session-import/artifacts.js";
import { prepareSessionImages } from "@/core/session-import/images.js";
import {
  findCurrentSession,
  type LocalSession,
  listSessions,
  parseSessionLink,
  teleportSession,
} from "@/core/session-import/sessions.js";
import { readFile } from "@/core/utils/fs.js";
import { readGitBranch } from "@/core/utils/git.js";

interface ImportOptions {
  current?: boolean;
  file?: string;
  token?: string;
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
  const content = await prepareSessionImages(
    await readSession(ctx, link, options),
  );
  if (content.length > MAX_SESSION_BYTES) {
    throw new InvalidInputError(
      "This session is over 50 MB and can't be imported.",
      { hints: [] },
    );
  }
  // A link's changes live in the cloud session and --file may come from anywhere.
  const sourceBranch =
    link || options.file ? undefined : await readGitBranch(process.cwd());
  const branches =
    command.optsWithGlobals<{ branch?: string[] }>().branch ?? [];

  if (!options.token) await ensureAuth(ctx);

  const { artifacts, skipped } = await collectArtifacts(content);
  ctx.log.info("This uploads the full conversation to Base Code.");
  if (artifacts.length) {
    ctx.log.info(
      `Sending ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}: ${artifacts.map((a) => a.fileName).join(", ")}`,
    );
  }
  for (const { fileName, reason } of skipped) {
    ctx.log.warn(`Not sending ${fileName}: ${reason}.`);
  }
  const imported = await ctx.runTask("Importing session", (updateMessage) =>
    uploadSession(appId, content, {
      token: options.token,
      sourceBranch,
      branches,
      artifacts,
      onRetry: ({ status, seconds, attempt, attempts }) =>
        updateMessage(
          `${status === 503 ? "GitHub is rate-limiting access checks" : "Too many imports"}. Retrying in ${seconds}s (attempt ${attempt} of ${attempts})…`,
        ),
    }),
  );
  const url = `${getBase44ApiUrl()}${imported.sessionUrl ?? imported.branchUrl}`;
  const { importedArtifacts: saved, skippedArtifacts: refused } = imported;
  const artifactLine =
    saved || refused
      ? `Artifacts: ${saved} saved${refused ? `, ${refused} not saved` : ""}.`
      : undefined;
  return {
    outroMessage: [
      outcome(imported),
      ...(artifactLine ? [artifactLine] : []),
      `Open it: ${url}`,
    ].join("\n"),
    stdout: ctx.jsonMode
      ? toJsonStdout({
          ...imported,
          url,
          sentArtifacts: artifacts.map((a) => a.fileName),
          unsentArtifacts: skipped,
        })
      : undefined,
  };
}

function outcome(imported: Awaited<ReturnType<typeof uploadSession>>): string {
  const { turnCount, branchName } = imported;
  const tool = TOOL_LABELS[imported.source];
  if (imported.reimported) {
    return turnCount
      ? `✓ Added ${turnCount} new messages from ${tool} to "${branchName}".`
      : `✓ Nothing new to import. "${branchName}" already has every message.`;
  }
  return imported.continued
    ? `✓ Imported ${turnCount} messages from ${tool}. Continued on "${branchName}".`
    : `✓ Imported ${turnCount} messages from ${tool} into branch "${branchName}".`;
}

export function getSessionsImportCommand(): Command {
  return (
    new Base44Command("import", {
      requireAuth: false,
      supportsBranch: "many",
    })
      .description("Continue a Claude Code or Codex session in Base Code")
      .argument(
        "[session-link]",
        "A claude.ai session address (https://claude.ai/code/session_…)",
      )
      .option("--current", "Import the session this command runs inside")
      .option("--file <path>", "Import this session file as is")
      // Accepted so prompts copied before the push check was removed still run.
      .addOption(new Option("--skip-push-check").hideHelp())
      .option(
        "--token <key>",
        "One-time import key from Base Code (no login needed)",
      )
      .addHelpText(
        "after",
        "\nThe global --branch <name> names a GitHub branch with this session's work; repeat it for each one.",
      )
      .action(importAction)
  );
}
