import chalk from "chalk";
import {
  bootstrapBlankApp,
  bootstrapBuilderApp,
} from "@/cli/commands/imported/create.js";
import {
  runGenesisSession,
  runInteractiveSession,
} from "@/cli/commands/imported/session.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { initAppContext } from "@/core/project/app-config.js";
import { soleActiveBranchId } from "@/core/resources/imported/api.js";

interface CodeOptions {
  import?: boolean;
  builder?: boolean;
}

async function codeAction(
  _ctx: CLIContext,
  options: CodeOptions,
): Promise<RunCommandResult> {
  if (process.stdout.isTTY !== true) {
    throw new InvalidInputError(
      "base44 code is an interactive session and needs a terminal.",
    );
  }
  if (options.import && options.builder) {
    throw new InvalidInputError(
      "Pass either --builder or --import, not both (the default is --builder).",
    );
  }
  const importMode = options.import === true;

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

  // Genesis mode picks the app type: --builder (default) makes a normal Base44
  // app (template + agent); --import makes an imported app (a repo, or
  // /headless → Wix Headless). The choice is a header/footer label + which
  // bootstrap runs; the session itself is identical either way.
  const footer: string[] = [
    importMode
      ? chalk.dim(`${chalk.hex("#E86B3C")("●")} import`)
      : chalk.dim(`${chalk.hex("#E86B3C")("●")} builder`),
  ];
  await runGenesisSession(
    importMode
      ? {
          idleHint:
            "describe the app, or import a repo — /headless for Wix Headless",
          creatingLabel: "creating your repository and app",
          modeLabel: "Import — your repo or /headless",
          footer,
          createApp: (prompt, emit) => bootstrapBlankApp(prompt, footer, emit),
        }
      : {
          idleHint: "describe the app you want to build",
          creatingLabel: "creating your app",
          modeLabel: "Builder — Base44 template + agent",
          footer,
          createApp: (prompt, emit) =>
            bootstrapBuilderApp(prompt, footer, emit),
        },
  );
  return { outroMessage: "Done." };
}

export function getCodeCommand(): Base44Command {
  const command = new Base44Command("code", { requireAppContext: false });
  command
    .description(
      "Open Base44 Code: an interactive agent session — in an empty directory, your first prompt creates the app (default: the Base44 builder; --import for a repo / Wix Headless)",
    )
    .option(
      "--builder",
      "From scratch with the Base44 builder agent + template (default)",
    )
    .option(
      "--import",
      "Start from a GitHub repo, or /headless for Wix Headless, instead of the Base44 template",
    )
    .action(codeAction);
  return command;
}
