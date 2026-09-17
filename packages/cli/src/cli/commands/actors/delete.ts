import type { Command } from "commander";
import { parseNames } from "@/cli/commands/functions/parseNames.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import {
  ApiError,
  InvalidInputError,
  ResourceDeploymentError,
} from "@/core/errors.js";
import {
  actorOperationError,
  deleteSingleActor,
  describeActorResult,
  type SingleActorDeleteResult,
  validateActorName,
} from "@/core/resources/actor/index.js";

async function deleteActorsAction(
  { log, jsonMode, runTask }: CLIContext,
  rawNames: string[],
): Promise<RunCommandResult> {
  const names = [...new Set(parseNames(rawNames))];
  if (!names.length)
    throw new InvalidInputError("At least one actor name is required");
  names.forEach(validateActorName);
  const results: SingleActorDeleteResult[] = [];
  for (const name of names) {
    try {
      await runTask(`Deleting ${name}...`, () => deleteSingleActor(name), {
        successMessage: `${name} deleted`,
        errorMessage: `Failed to delete ${name}`,
      });
      results.push({ name, status: "deleted" });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        results.push({ name, status: "not_found" });
        log.info(`${name} not found`);
      } else {
        const result = actorOperationError(name, error);
        results.push(result);
        log.error(describeActorResult(result));
      }
    }
  }
  const summary = {
    deleted: results.filter((result) => result.status === "deleted").length,
    notFound: results.filter((result) => result.status === "not_found").length,
    failed: results.filter((result) => result.status === "error").length,
  };
  if (summary.failed)
    throw new ResourceDeploymentError("Actor deletion failed", {
      details: results.map(describeActorResult),
    });
  return {
    outroMessage:
      names.length === 1
        ? `Actor "${names[0]}" ${summary.deleted ? "deleted" : "not found"}`
        : `${summary.deleted} deleted, ${summary.notFound} not found`,
    stdout: jsonMode
      ? `${JSON.stringify({ actors: results, summary })}\n`
      : undefined,
  };
}

export function getDeleteCommand(): Command {
  return new Base44Command("delete")
    .description("Delete deployed actors")
    .argument("[names...]", "Actor names to delete (required)")
    .action(deleteActorsAction);
}
