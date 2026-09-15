import { bootstrapBlankApp } from "@/cli/commands/imported/create.js";
import {
  runGenesisSession,
  runInteractiveSession,
} from "@/cli/commands/imported/session.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { initAppContext } from "@/core/project/app-config.js";
import { soleActiveBranchId } from "@/core/resources/imported/api.js";

async function codeAction(_ctx: CLIContext): Promise<RunCommandResult> {
  if (process.stdout.isTTY !== true) {
    throw new InvalidInputError(
      "base44 code is an interactive session and needs a terminal.",
    );
  }

  // Inside a linked app project, open the session on that app; anywhere
  // else, the first prompt creates one from scratch. Resolution must be the
  // real app-context lookup — an existence glob is recursive and would match
  // apps in SUBdirectories of an unlinked cwd.
  let linked = false;
  try {
    await initAppContext();
    linked = true;
  } catch {
    // Not a linked project — genesis mode below.
  }
  if (linked) {
    const branchId = await soleActiveBranchId().catch(() => undefined);
    await runInteractiveSession({
      branchId,
      footer: [],
      primeFirstPoll: true,
      idleHint: "what should the agent do next?",
    });
    return { outroMessage: "Done." };
  }

  const footer: string[] = [];
  await runGenesisSession({
    idleHint: "describe the app you want to build",
    creatingLabel: "creating your repository and app",
    footer,
    createApp: (prompt, emit) => bootstrapBlankApp(prompt, footer, emit),
  });
  return { outroMessage: "Done." };
}

export function getCodeCommand(): Base44Command {
  const command = new Base44Command("code", { requireAppContext: false });
  command
    .description(
      "Open Base44 Code: an interactive agent session — in an empty directory, your first prompt creates the app",
    )
    .action(codeAction);
  return command;
}
