import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getPreviewUrl } from "@/core/resources/apps/api.js";

async function previewAction(ctx: CLIContext): Promise<RunCommandResult> {
  const url = await ctx.runTask(
    "Resolving preview URL (boots the sandbox if needed)",
    () => getPreviewUrl(),
  );
  if (ctx.jsonMode)
    return { stdout: `${JSON.stringify({ preview_url: url })}\n` };
  ctx.log.message(url);
  return { outroMessage: "Preview is live." };
}

export function getSandboxPreviewCommand(): Base44Command {
  const command = new Base44Command("preview");
  command.description("Print the app's live preview URL").action(previewAction);
  return command;
}
