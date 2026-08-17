import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, parseNames } from "@/cli/utils/index.js";
import { ApiError } from "@/core/errors.js";
import { deleteSingleActor } from "@/core/resources/actor/api.js";

async function deleteActorsAction(
  { runTask }: CLIContext,
  names: string[],
): Promise<RunCommandResult> {
  let deleted = 0;
  let notFound = 0;
  let errors = 0;

  for (const name of names) {
    try {
      await runTask(`Deleting ${name}...`, () => deleteSingleActor(name), {
        successMessage: `${name} deleted`,
        errorMessage: `Failed to delete ${name}`,
      });
      deleted++;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        notFound++;
      } else {
        errors++;
      }
    }
  }

  if (names.length === 1) {
    if (deleted) return { outroMessage: `Actor "${names[0]}" deleted` };
    if (notFound) return { outroMessage: `Actor "${names[0]}" not found` };
    return { outroMessage: `Failed to delete "${names[0]}"` };
  }

  const total = names.length;
  const parts: string[] = [];
  if (deleted > 0) parts.push(`${deleted}/${total} deleted`);
  if (notFound > 0) parts.push(`${notFound} not found`);
  if (errors > 0) parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);
  return { outroMessage: parts.join(", ") };
}

function validateNames(command: Command): void {
  const names = parseNames(command.args);
  if (names.length === 0) {
    command.error("At least one actor name is required");
  }
}

export function getDeleteCommand(): Command {
  return new Base44Command("delete")
    .description("Delete deployed actors")
    .argument("<names...>", "Actor names to delete")
    .hook("preAction", validateNames)
    .action(async (ctx: CLIContext, rawNames: string[]) => {
      const names = parseNames(rawNames);
      return deleteActorsAction(ctx, names);
    });
}
