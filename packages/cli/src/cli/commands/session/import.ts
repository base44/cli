import { cancel, isCancel, select } from "@clack/prompts";
import ms from "ms";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  confirmPush,
  getBaseCodeUrl,
  requireApp,
  theme,
  toJsonStdout,
} from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  defaultSessionRoots,
  importSession,
  type LocalSession,
  listSessions,
  prepareTranscript,
  readSessionById,
  SESSION_SOURCE_LABELS,
} from "@/core/session-import/index.js";
import { findGitRoot } from "@/core/utils/git.js";

interface ImportOptions {
  session?: string;
  all?: boolean;
  yes?: boolean;
}

const PICKER_LIMIT = 30;

async function pickSession(all: boolean | undefined): Promise<string> {
  const within = all ? undefined : ((await findGitRoot()) ?? process.cwd());
  const sessions = await listSessions(defaultSessionRoots(), {
    within,
    limit: PICKER_LIMIT,
  });
  if (sessions.length === 0) {
    throw new InvalidInputError(
      all
        ? "No Claude Code or Codex sessions found on this machine."
        : "No Claude Code or Codex sessions found for this repository. Pass --all to list sessions from every directory, or --session <id>.",
    );
  }
  const choice = await select<LocalSession>({
    message: "Which session do you want to continue in Base Code?",
    options: sessions.map((session) => ({
      value: session,
      label: session.title,
      hint: `${SESSION_SOURCE_LABELS[session.source]}, ${ms(Date.now() - session.updatedAtMs)} ago`,
    })),
  });
  if (isCancel(choice)) {
    cancel("Operation cancelled.");
    throw new CLIExitError(0);
  }
  return choice.id;
}

async function importSessionAction(
  ctx: CLIContext,
  options: ImportOptions,
): Promise<RunCommandResult> {
  const { log, runTask, jsonMode } = ctx;
  const interactive = !ctx.isNonInteractive && !jsonMode;
  const appId = requireApp(ctx).id;

  if (!options.session && !interactive) {
    throw new InvalidInputError(
      "--session <id> is required in non-interactive mode",
    );
  }
  const sessionId = options.session ?? (await pickSession(options.all));

  const found = await runTask("Reading session", () =>
    readSessionById(defaultSessionRoots(), sessionId),
  );
  if (!found) {
    throw new InvalidInputError(
      `No Claude Code or Codex session with id "${sessionId}" was found on this machine.`,
    );
  }
  const { session } = found;
  const { turns, droppedTurns } = prepareTranscript(found.turns);
  if (turns.length === 0) {
    throw new InvalidInputError(
      "This session has no conversation text to import.",
    );
  }
  if (droppedTurns > 0) {
    log.info(
      `Sending the latest ${turns.length} messages; ${droppedTurns} older ones exceed the size limit.`,
    );
  }

  const confirmed = await confirmPush({
    isNonInteractive: !interactive,
    yes: options.yes,
    log,
    warning: `This uploads the ${turns.length} messages of "${session.title}" to your Base44 app. Only text goes up; tool calls and their output stay on this machine.`,
  });
  if (!confirmed) {
    return { outroMessage: "Import cancelled" };
  }

  const imported = await runTask("Importing session", () =>
    importSession({
      source: session.source,
      sessionId: session.id,
      title: session.title,
      turns,
    }),
  );
  const url = getBaseCodeUrl(appId, imported.branchName);
  const result = {
    branchId: imported.branchId,
    branchName: imported.branchName,
    url,
    created: imported.created,
    source: session.source,
    sessionId: session.id,
    messageCount: turns.length,
  };
  return {
    outroMessage: `${imported.created ? "Imported into" : "Already imported into"} branch ${theme.styles.bold(imported.branchName)}\n${theme.colors.links(url)}`,
    stdout: jsonMode ? toJsonStdout(result) : undefined,
  };
}

export function getSessionImportCommand(): Base44Command {
  return new Base44Command("import")
    .description(
      "Continue a local Claude Code or Codex session in a Base Code branch",
    )
    .option("--session <id>", "Session id to import (skips the picker)")
    .option(
      "--all",
      "List sessions from every directory, not just this repository",
    )
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(importSessionAction);
}
