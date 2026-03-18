import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { ApiError } from "@/core/errors.js";
import { deleteSingleFunction } from "@/core/resources/function/api.js";

async function deleteFunctionsAction(
  names: string[],
): Promise<RunCommandResult> {
  let deleted = 0;
  let notFound = 0;
  let errors = 0;

  for (const name of names) {
    try {
      await runTask(`Deleting ${name}...`, () => deleteSingleFunction(name), {
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
    if (deleted) return { outroMessage: `Function "${names[0]}" deleted` };
    if (notFound) return { outroMessage: `Function "${names[0]}" not found` };
    return { outroMessage: `Failed to delete "${names[0]}"` };
  }

  const total = names.length;
  const parts: string[] = [];
  if (deleted > 0) parts.push(`${deleted}/${total} deleted`);
  if (notFound > 0) parts.push(`${notFound} not found`);
  if (errors > 0) parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);
  return { outroMessage: parts.join(", ") };
}

/** Parse names from variadic CLI args, supporting comma-separated values. */
function parseNames(args: string[]): string[] {
  return args
    .flatMap((arg) => arg.split(","))
    .map((n) => n.trim())
    .filter(Boolean);
}

function validateNames(command: Command): void {
  const names = parseNames(command.args);
  if (names.length === 0) {
    command.error("At least one function name is required");
  }
}

export function getDeleteCommand(): Command {
  return new Base44Command("delete")
    .description("Delete deployed functions")
    .argument("<names...>", "Function names to delete")
    .hook("preAction", validateNames)
    .action(async (rawNames: string[]) => {
      const names = parseNames(rawNames);
      return deleteFunctionsAction(names);
    });
}
