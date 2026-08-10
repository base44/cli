import type { Command } from "commander";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  buildDeploySummary,
  formatDeployResult,
  parseNames,
  theme,
} from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import { deployActorsSequentially } from "@/core/resources/actor/deploy.js";
import type { Actor } from "@/core/resources/actor/schema.js";

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

async function deployActorsAction(
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
    log.message(buildDeploySummary(results, "actors"));
    throw new CLIExitError(1);
  }

  return { outroMessage: buildDeploySummary(results, "actors") };
}

export function getDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy actors to Base44")
    .argument("[names...]", "Actor names to deploy (deploys all if omitted)")
    .action(async (ctx: CLIContext, rawNames: string[]) => {
      const names = parseNames(rawNames);
      return deployActorsAction(ctx, names);
    });
}
