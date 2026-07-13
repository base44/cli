import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { readDevInstance } from "@/core/local-state/index.js";

async function devStatusAction(ctx: CLIContext): Promise<RunCommandResult> {
  const { log, app, jsonMode } = ctx;
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 dev status requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }

  const instance = await readDevInstance(app.projectRoot);
  // dev.json minus adminToken (and pid) — the machine-readable status shape.
  const status = instance
    ? {
        running: true,
        appId: instance.appId,
        url: instance.url,
        port: instance.port,
        startedAt: instance.startedAt,
        dataDir: instance.dataDir,
        seed: instance.seed,
      }
    : { running: false };

  const outroMessage = instance
    ? `Dev server is running at ${theme.colors.links(instance.url)}`
    : "No dev server is running for this project.";

  if (jsonMode) {
    return { outroMessage, stdout: `${JSON.stringify(status, null, 2)}\n` };
  }

  if (instance) {
    log.info(
      [
        `App ID: ${instance.appId}`,
        `URL: ${theme.colors.links(instance.url)}`,
        `Port: ${instance.port}`,
        `Started at: ${instance.startedAt}`,
        `Data dir: ${instance.dataDir}`,
      ].join("\n"),
    );
  }

  return { outroMessage };
}

export function getDevStatusCommand(): Command {
  return new Base44Command("status", { requireAuth: false })
    .description("Show the status of the local development server")
    .action(devStatusAction);
}
