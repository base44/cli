import { Argument, type Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { setAppVisibility } from "@/core/project/api.js";
import { VISIBILITY_LEVELS, type Visibility } from "@/core/project/schema.js";

async function setVisibility(
  { runTask }: CLIContext,
  level: Visibility,
): Promise<RunCommandResult> {
  await runTask(`Setting app visibility to ${level}`, () =>
    setAppVisibility(level),
  );

  return { outroMessage: `App visibility set to ${level}` };
}

export function getVisibilityCommand(): Command {
  return new Base44Command("visibility")
    .description(
      "Set the app's visibility on the server (public, private, or workspace)",
    )
    .addArgument(
      new Argument("<level>", "Visibility level").choices([
        ...VISIBILITY_LEVELS,
      ]),
    )
    .action(setVisibility);
}
