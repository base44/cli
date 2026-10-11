import type { Command } from "commander";
import { createServeCommandRunner } from "@/cli/dev/serve-command-runner.js";
import { stopRunnerOnProcessSignals } from "@/cli/dev/stop-runner-on-signals.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { ConfigInvalidError } from "@/core/errors.js";
import {
  readProjectSettingsOrDefaults,
  siteOrDefault,
} from "@/core/project/index.js";

/**
 * What to run when a project has a site but names no dev server. Not a schema
 * default: `base44 dev` reads an absent `serveCommand` as "no frontend to run
 * here", so only a command that exists purely to serve one may assume this.
 */
const DEFAULT_SERVE_COMMAND = "npm run dev";

async function siteDevAction(
  ctx: CLIContext,
  forwarded: string[],
): Promise<RunCommandResult> {
  const { app } = ctx;
  // The framework's own app-context step has already refused with actionable
  // hints, so this is the type's guard. No projectRoot is fine: a checkout
  // whose config is missing or gitignored still serves, with the defaults.
  if (!app) {
    throw new ConfigInvalidError(
      "base44 site dev requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }

  // Config only, like `site install`: serving the frontend reads none of the
  // project's resource files, so an invalid one must not fail it.
  const project = await readProjectSettingsOrDefaults(app.projectRoot);
  const site = siteOrDefault(project);

  // Run as written: where the dev server binds is the command's own business.
  // In a sandbox @base44/vite-plugin binds 0.0.0.0:5173 for Base44 apps; any
  // other serveCommand must bind the address the sandbox exposes itself. What
  // the caller put after `--` is appended, and only that.
  const serveCommand = site.serveCommand ?? DEFAULT_SERVE_COMMAND;
  const command = [serveCommand, ...forwarded].join(" ");

  const runner = createServeCommandRunner({
    serveCommand: command,
    projectRoot: project.root,
    appId: app.id,
  });
  stopRunnerOnProcessSignals(runner);
  runner.onExit((code) => process.exit(code ?? 1));
  runner.start();

  return { outroMessage: `Frontend dev server running '${command}'` };
}

export function getSiteDevCommand(): Command {
  // The frontend alone, reaching its backend same-origin — what a hosted sandbox
  // needs. `base44 dev` is the developer-machine command: it also runs the
  // backend, locally or (with --remote) the app's published one.
  return new Base44Command("dev", { requireAuth: false })
    .description("Run the site's dev server, with no local backend")
    .argument("[args...]", "Arguments appended to the serveCommand, after --")
    .action(siteDevAction);
}
