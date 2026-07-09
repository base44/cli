import type { Logger } from "@base44-cli/logger";
import type { Command } from "commander";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import {
  deployActorsSequentially,
  type SingleActorDeployResult,
} from "@/core/resources/actor/deploy.js";
import type { Actor } from "@/core/resources/actor/schema.js";

function parseNames(args: string[]): string[] {
  return args
    .flatMap((arg) => arg.split(","))
    .map((n) => n.trim())
    .filter(Boolean);
}

function resolveActorsToDeploy(names: string[], allActors: Actor[]): Actor[] {
  if (names.length === 0) return allActors;

  const notFound = names.filter((n) => !allActors.some((a) => a.name === n));
  if (notFound.length > 0) {
    throw new InvalidInputError(
      `Actor${notFound.length > 1 ? "s" : ""} not found in project: ${notFound.join(", ")}`,
    );
  }
  return allActors.filter((a) => names.includes(a.name));
}

function formatDeployResult(
  result: SingleActorDeployResult,
  log: Logger,
): void {
  const label = result.name.padEnd(25);
  if (result.status === "deployed") {
    const timing = result.durationMs
      ? theme.styles.dim(` (${(result.durationMs / 1000).toFixed(1)}s)`)
      : "";
    log.success(`${label} deployed${timing}`);
  } else if (result.status === "unchanged") {
    log.success(`${label} unchanged`);
  } else {
    log.error(`${label} error: ${result.error}`);
  }
}

function buildDeploySummary(results: SingleActorDeployResult[]): string {
  const deployed = results.filter((r) => r.status === "deployed").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  const failed = results.filter((r) => r.status === "error").length;

  const parts: string[] = [];
  if (deployed > 0) parts.push(`${deployed} deployed`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (failed > 0) parts.push(`${failed} error${failed !== 1 ? "s" : ""}`);
  return parts.join(", ") || "No actors deployed";
}

async function deployActorAction(
  { log }: CLIContext,
  names: string[],
): Promise<RunCommandResult> {
  const { actors } = await readProjectConfig();
  const toDeploy = resolveActorsToDeploy(names, actors);

  if (toDeploy.length === 0) {
    return {
      outroMessage: "No actors found. Create actors in the 'actors' directory.",
    };
  }

  log.info(
    `Found ${toDeploy.length} ${toDeploy.length === 1 ? "actor" : "actors"} to deploy`,
  );

  let completed = 0;
  const total = toDeploy.length;

  const results = await deployActorsSequentially(toDeploy, {
    onStart: (startNames) => {
      const label =
        startNames.length === 1 ? startNames[0] : `${startNames.length} actors`;
      log.step(
        theme.styles.dim(`[${completed + 1}/${total}] Deploying ${label}...`),
      );
    },
    onResult: (result) => {
      completed++;
      formatDeployResult(result, log);
    },
  });

  const hasFailures = results.some((r) => r.status === "error");
  if (hasFailures) {
    log.message(buildDeploySummary(results));
    throw new CLIExitError(1);
  }

  return { outroMessage: buildDeploySummary(results) };
}

export function getDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy actors to Base44")
    .argument("[names...]", "Actor names to deploy (deploys all if omitted)")
    .action(async (ctx: CLIContext, rawNames: string[]) => {
      const names = parseNames(rawNames);
      return deployActorAction(ctx, names);
    });
}
