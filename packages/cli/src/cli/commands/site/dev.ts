import type { Command } from "commander";
import { createServeCommandRunner } from "@/cli/dev/serve-command-runner.js";
import { stopRunnerOnProcessSignals } from "@/cli/dev/stop-runner-on-signals.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { ConfigInvalidError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";

/**
 * What to run when a project has a site but names no dev server. Not a schema
 * default: `base44 dev` reads an absent `serveCommand` as "no frontend to run
 * here", so only a command that exists purely to serve one may assume this.
 */
const DEFAULT_SERVE_COMMAND = "npm run dev";

async function siteDevAction(ctx: CLIContext): Promise<RunCommandResult> {
  const { app } = ctx;
  // Same shape as `base44 build`: the framework's own app-context step has
  // already refused with actionable hints, so this is the type's guard.
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 site dev requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }

  const { project } = await readProjectConfig(app.projectRoot);
  const site = project.site;
  if (!site) {
    throw new InvalidInputError(
      "This project has no 'site' block in base44/config.jsonc, so there is no frontend to serve. Add one naming its serveCommand; site dev falls back to \"npm run dev\".",
    );
  }

  // Run as written: where the dev server binds is the command's own business.
  // In a sandbox @base44/vite-plugin binds 0.0.0.0:5173 for Base44 apps; any
  // other serveCommand must bind the address the sandbox exposes itself.
  const command = site.serveCommand ?? DEFAULT_SERVE_COMMAND;

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
    .action(siteDevAction);
}
