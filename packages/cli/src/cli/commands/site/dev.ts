import type { Command } from "commander";
import { createServeCommandRunner } from "@/cli/dev/serve-command-runner.js";
import { stopRunnerOnProcessSignals } from "@/cli/dev/stop-runner-on-signals.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  DEFAULT_SERVE_COMMAND,
  forwardsServeAddress,
  withServeAddress,
} from "@/core/site/serve-command.js";

interface SiteDevOptions extends AppIdOptions {
  backendUrl?: string;
  host?: string;
  port?: string;
}

async function siteDevAction(
  ctx: CLIContext,
  options: SiteDevOptions,
): Promise<RunCommandResult> {
  const { app, log } = ctx;
  if (!app) {
    throw new InvalidInputError("No app id resolved for this project.");
  }

  const port = options.port === undefined ? undefined : Number(options.port);
  if (port !== undefined && !Number.isInteger(port)) {
    throw new InvalidInputError(
      `--port must be a whole number: ${options.port}`,
    );
  }

  const { project } = await readProjectConfig(app.projectRoot);
  const site = project.site;
  if (!site) {
    throw new InvalidInputError(
      "This project has no 'site' block in base44/config.jsonc, so there is no frontend to serve. Add one; inside it serveCommand defaults to \"npm run dev\".",
    );
  }

  // Serving is this command's whole job, so an unnamed dev server is the
  // convention rather than "nothing to run".
  const serveCommand = site.serveCommand ?? DEFAULT_SERVE_COMMAND;
  const command = withServeAddress(serveCommand, {
    host: options.host,
    port,
    hostFlag: site.devHostFlag,
  });
  // Said out loud rather than silently dropped: a caller that asked for an
  // address and did not get one would otherwise find out from a preview that
  // never loads.
  if (
    (options.host || port !== undefined) &&
    !forwardsServeAddress(serveCommand)
  ) {
    log.warn(
      `serveCommand '${serveCommand}' is not an 'npm run' invocation, so --host/--port were not passed to it. Put the address in serveCommand itself.`,
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
    .option("--host <address>", "Address to bind, e.g. 0.0.0.0")
    .option("--port <number>", "Port to bind")
    .action(siteDevAction);
}
