import type { Command } from "commander";
import { formatDeployResult } from "@/cli/commands/functions/formatDeployResult.js";
import { parseNames } from "@/cli/commands/functions/parseNames.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError, ResourceDeploymentError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/config.js";
import {
  deployActorsSequentially,
  describeActorResult,
  validateActorName,
} from "@/core/resources/actor/index.js";

async function deployActorsAction(
  { log, jsonMode }: CLIContext,
  rawNames: string[],
): Promise<RunCommandResult> {
  const names = [...new Set(parseNames(rawNames))];
  if (rawNames.length && !names.length)
    throw new InvalidInputError("At least one actor name is required");
  names.forEach(validateActorName);
  const { actors, project } = await readProjectConfig();
  const notFound = names.filter(
    (name) => !actors.some((actor) => actor.name === name),
  );
  if (notFound.length)
    throw new InvalidInputError(
      `Actor not found in project: ${notFound.join(", ")}`,
    );
  const selected = names.length
    ? actors.filter((actor) => names.includes(actor.name))
    : actors;
  let completed = 0;
  if (selected.length)
    log.info(
      `Found ${selected.length} ${selected.length === 1 ? "actor" : "actors"} to deploy`,
    );
  const results = await deployActorsSequentially(selected, {
    onStart: (name) =>
      log.step(
        theme.styles.dim(
          `[${completed + 1}/${selected.length}] Deploying ${name}...`,
        ),
      ),
    onResult: (result) => {
      completed++;
      formatDeployResult(result, log);
      if (result.status !== "error")
        for (const warning of result.warnings)
          log.warn(`${result.name}: ${warning}`);
    },
  });
  const summary = {
    deployed: results.filter((result) => result.status === "deployed").length,
    unchanged: results.filter((result) => result.status === "unchanged").length,
    failed: results.filter((result) => result.status === "error").length,
  };
  const message = Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  if (summary.failed) {
    throw new ResourceDeploymentError(message, {
      details: results.map(describeActorResult),
    });
  }
  return {
    outroMessage:
      message ||
      `No actors found. Create actors in the '${project.actorsDir}' directory.`,
    stdout: jsonMode
      ? `${JSON.stringify({ actors: results, summary })}\n`
      : undefined,
  };
}

export function getDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy actors to Base44")
    .argument("[names...]", "Actor names to deploy (deploys all if omitted)")
    .action(deployActorsAction);
}
