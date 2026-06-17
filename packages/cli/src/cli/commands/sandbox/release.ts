import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { releaseSession } from "@/core/resources/sandbox/api.js";
import { toJsonStdout } from "./shared.js";

async function releaseAction({
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();

  const result = await runTask("Releasing sandbox session", () =>
    releaseSession(appId),
  );

  return {
    outroMessage: "Released sandbox session",
    stdout: toJsonStdout(result),
  };
}

export function getSandboxReleaseCommand(): Command {
  return new Base44Command("release")
    .description(
      "Release the external-agent session so the in-app builder can resume",
    )
    .action(releaseAction);
}
