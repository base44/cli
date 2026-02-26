import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { parseNames } from "@/cli/utils/parseNames.js";
import { ApiError, InvalidInputError } from "@/core/errors.js";
import { deleteSingleFunction } from "@/core/resources/function/api.js";

async function deleteFunctionsAction(
  names: string[],
): Promise<RunCommandResult> {
  let deleted = 0;
  let notFound = 0;
  let errors = 0;
  let completed = 0;
  const total = names.length;

  for (const name of names) {
    log.step(theme.styles.dim(`[${completed + 1}/${total}] Deleting ${name}...`));
    try {
      await deleteSingleFunction(name);
      log.success(`${name.padEnd(25)} deleted`);
      deleted++;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        log.warn(`${name.padEnd(25)} not found`);
        notFound++;
      } else {
        log.error(`${name.padEnd(25)} error: ${error instanceof Error ? error.message : String(error)}`);
        errors++;
      }
    }
    completed++;
  }

  if (names.length === 1) {
    if (deleted) return { outroMessage: `Function "${names[0]}" deleted` };
    if (notFound) return { outroMessage: `Function "${names[0]}" not found` };
    return { outroMessage: `Failed to delete "${names[0]}"` };
  }

  const parts: string[] = [];
  if (deleted > 0) parts.push(`${deleted}/${total} deleted`);
  if (notFound > 0) parts.push(`${notFound} not found`);
  if (errors > 0) parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);
  return { outroMessage: parts.join(", ") };
}

export function getDeleteCommand(context: CLIContext): Command {
  return new Command("delete")
    .description("Delete deployed functions")
    .argument("<names...>", "Function names to delete")
    .action(async (rawNames: string[]) => {
      await runCommand(
        () => {
          const names = parseNames(rawNames);
          if (names.length === 0) {
            throw new InvalidInputError("At least one function name is required");
          }
          return deleteFunctionsAction(names);
        },
        { requireAuth: true },
        context,
      );
    });
}
