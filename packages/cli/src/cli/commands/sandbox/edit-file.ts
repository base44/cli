import type { Command } from "commander";
import { z } from "zod";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/index.js";
import { editFile } from "@/core/resources/sandbox/api.js";
import type { EditSpec } from "@/core/resources/sandbox/schema.js";
import { resolveFlagOrStdin, toJsonStdout } from "./shared.js";

interface EditFileOptions {
  editsJson?: string;
  dryRun?: boolean;
}

const EditsInputSchema = z
  .array(
    z.object({
      old_text: z.string().min(1),
      new_text: z.string(),
      replace_all: z.boolean().optional(),
    }),
  )
  .min(1);

function parseEdits(raw: string): EditSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidInputError(
      "--edits-json must be valid JSON (an array of { old_text, new_text, replace_all? }).",
    );
  }
  const result = EditsInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidInputError(
      "Invalid edits: expected a non-empty array of { old_text (non-empty string), new_text (string), replace_all? (boolean) }.",
    );
  }
  return result.data;
}

async function editFileAction(
  { runTask }: CLIContext,
  path: string,
  options: EditFileOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();
  const raw = await resolveFlagOrStdin(options.editsJson, "--edits-json");
  const edits = parseEdits(raw);

  const result = await runTask(
    options.dryRun ? "Previewing edit" : "Editing file",
    () => editFile(appId, { path, edits, dry_run: options.dryRun }),
  );

  return {
    outroMessage: options.dryRun ? "Previewed edit" : "Edited file",
    stdout: toJsonStdout(result),
  };
}

export function getSandboxEditFileCommand(): Command {
  return new Base44Command("edit")
    .description("Apply exact old→new string edits to a file in the sandbox")
    .argument("<path>", "File path relative to the app root")
    .option(
      "--edits-json <json>",
      "JSON array of edits (if omitted, read from stdin)",
    )
    .option("--dry-run", "Return the unified diff without writing")
    .addHelpText(
      "after",
      `
Each edit is { "old_text": "...", "new_text": "...", "replace_all"?: true }.

Examples:
  $ echo '[{"old_text":"foo","new_text":"bar"}]' | base44 sandbox edit src/x.ts
  $ base44 sandbox edit src/x.ts --dry-run --edits-json '[{"old_text":"a","new_text":"b","replace_all":true}]'`,
    )
    .action(editFileAction);
}
