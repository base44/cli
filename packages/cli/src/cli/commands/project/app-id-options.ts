import type { Command } from "commander";
import type { AppIdOptions } from "@/cli/utils/index.js";

interface LegacyProjectIdOptions {
  projectId?: string;
}

interface ExplicitAppIdSelection {
  appId?: string;
  legacyProjectId?: string;
  value?: string;
}

export function readExplicitAppId(command: Command): ExplicitAppIdSelection {
  const { appId } = command.optsWithGlobals<AppIdOptions>();
  const { projectId } = command.opts<LegacyProjectIdOptions>();

  const explicitAppId =
    command.getOptionValueSourceWithGlobals("appId") === "cli"
      ? appId
      : undefined;
  // TODO: Remove legacy --project-id parsing once docs and Base44 CLI skills use --app-id.
  const legacyProjectId =
    command.getOptionValueSource("projectId") === "cli" ? projectId : undefined;

  return {
    appId: explicitAppId,
    legacyProjectId,
    value: explicitAppId ?? legacyProjectId,
  };
}
