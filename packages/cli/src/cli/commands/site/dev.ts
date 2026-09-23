import type { Command } from "commander";
import { createServeCommandRunner } from "@/cli/dev/serve-command-runner.js";
import { stopRunnerOnProcessSignals } from "@/cli/dev/stop-runner-on-signals.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigInvalidError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  DEFAULT_SERVE_COMMAND,
  withServeAddress,
} from "@/core/site/serve-command.js";

interface SiteDevOptions extends AppIdOptions {
  backendUrl?: string;
}

async function siteDevAction(
  ctx: CLIContext,
  options: SiteDevOptions,
): Promise<RunCommandResult> {
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

  // Serving is this command's whole job, so an unnamed dev server is a
  // convention rather than "nothing to run". Everything else comes from the
  // config, which is why this command takes no arguments for it.
  const serveCommand = site.serveCommand ?? DEFAULT_SERVE_COMMAND;
  const { command, droppedAddress } = withServeAddress(serveCommand, {
    host: site.devHost,
    port: site.devPort,
    hostFlag: site.devHostFlag,
  });
  // An address that cannot be delivered is a failure, not a warning: the caller
  // is usually a sandbox, and it would otherwise get a preview on some other
  // port and a zero exit status saying everything worked.
  if (droppedAddress) {
    throw new InvalidInputError(
      `serveCommand '${serveCommand}' takes no forwarded arguments, so the bind address cannot be passed to it. Bind it inside serveCommand itself, or use an 'npm run', 'pnpm', 'yarn' or 'bun run' script.`,
    );
  }

  const runner = createServeCommandRunner({
    serveCommand: command,
    projectRoot: project.root,
    appId: app.id,
    appBaseUrl: options.backendUrl,
  });
  stopRunnerOnProcessSignals(runner);
  runner.onExit((code) => process.exit(code ?? 1));
  runner.start();

  return {
    outroMessage: options.backendUrl
      ? `Frontend dev server running '${command}' against ${theme.styles.bold(options.backendUrl)}`
      : `Frontend dev server running '${command}'`,
  };
}

export function getSiteDevCommand(): Command {
  // The frontend alone, against a backend the caller names — what a hosted
  // sandbox needs. `base44 dev` is the developer-machine command: it also runs
  // the backend, locally or (with --remote) the app's published one.
  return new Base44Command("dev", { requireAuth: false })
    .description(
      "Run the site's dev server against a given backend (no local backend)",
    )
    .option(
      "--backend-url <url>",
      "Backend the frontend should call, injected as VITE_BASE44_APP_BASE_URL. Omit for a frontend that reaches its backend same-origin.",
    )
    .action(siteDevAction);
}
